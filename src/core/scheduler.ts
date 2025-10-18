/**
 * Task scheduling and distribution system
 */

import { EventEmitter } from 'events';
import { Logger } from './logger.js';
import { Task, TaskStatus, AgentId } from './types.js';
import { AgentRegistry } from '../agents/registry.js';
import { ResourceManager } from './resources.js';

// Simple UUID generator for testing
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

const MAX_TASK_DEFERRAL_COUNT = 5;
const MAX_TASK_DEFERRAL_MS = 5000;

interface TaskDeferralState {
  count: number;
  firstDeferAt: number;
  lastReason: string;
}

export class TaskScheduler extends EventEmitter {
  private logger = Logger.getInstance();
  private pendingTasks: Map<string, Task> = new Map();
  private runningTasks: Map<string, Task> = new Map();
  private completedTasks: Map<string, Task> = new Map();
  private taskQueue: Task[] = [];
  private schedulerInterval?: NodeJS.Timeout;
  private isRunning = false;
  private taskDeferrals: Map<string, TaskDeferralState> = new Map();

  constructor(private agentRegistry: AgentRegistry, private resourceManager?: ResourceManager) {
    super();
    this.logger.info('scheduler', 'Task scheduler created');
  }

  async initialize(): Promise<void> {
    this.logger.info('scheduler', 'Initializing task scheduler...');
    
    this.isRunning = true;
    this.schedulerInterval = setInterval(() => {
      void this.processTasks();
    }, 1000); // Check every second

    this.setupEventHandlers();
    
    this.logger.info('scheduler', 'Task scheduler initialized');
  }

  async shutdown(): Promise<void> {
    this.logger.info('scheduler', 'Shutting down task scheduler...');
    
    this.isRunning = false;
    
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = undefined;
    }

    // Cancel all running tasks
    for (const task of this.runningTasks.values()) {
      task.status = TaskStatus.CANCELLED;
      this.emit('taskCancelled', task);
    }

    this.logger.info('scheduler', 'Task scheduler shutdown complete');
  }

  private setupEventHandlers(): void {
    this.agentRegistry.on('agentStatusChanged', (agentId: AgentId, status: string) => {
      if (status === 'offline' || status === 'error') {
        this.handleAgentFailure(agentId);
      }
    });
  }

  private handleAgentFailure(agentId: AgentId): void {
    this.logger.warn('scheduler', 'Handling agent failure', { agentId: agentId.id });
    
    // Find tasks assigned to the failed agent
    const affectedTasks = Array.from(this.runningTasks.values()).filter(
      task => task.assignedTo?.id === agentId.id
    );

    for (const task of affectedTasks) {
      this.resourceManager?.releaseTenantTaskSlot(task.tenantId);
      task.status = TaskStatus.PENDING;
      task.assignedTo = undefined;
      this.runningTasks.delete(task.id);
      this.pendingTasks.set(task.id, task);
      
      this.logger.info('scheduler', 'Task reassigned due to agent failure', { 
        taskId: task.id, 
        failedAgent: agentId.id 
      });
    }
  }

  submitTask(taskData: {
    type: string;
    priority?: number;
    requiredCapabilities: string[];
    payload: Record<string, any>;
    deadline?: Date;
    tenantId?: string;
  }): Task {
    const task: Task = {
      id: generateUUID(),
      type: taskData.type,
      priority: taskData.priority || 0,
      requiredCapabilities: taskData.requiredCapabilities,
      payload: taskData.payload,
      tenantId: taskData.tenantId,
      created: new Date(),
      deadline: taskData.deadline,
      status: TaskStatus.PENDING
    };

    this.pendingTasks.set(task.id, task);
    this.taskQueue.push(task);
    
    // Sort by priority (higher priority first) and then by creation time
    this.taskQueue.sort((a, b) => {
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }
      return a.created.getTime() - b.created.getTime();
    });

    this.logger.info('scheduler', 'Task submitted', {
      taskId: task.id,
      type: task.type,
      priority: task.priority,
      tenantId: task.tenantId
    });
    
    this.emit('taskSubmitted', task);
    return task;
  }

  private async processTasks(): Promise<void> {
    if (!this.isRunning || this.taskQueue.length === 0) {
      return;
    }

    // Process expired tasks
    this.checkExpiredTasks();

    // Try to assign tasks to available agents
    const availableAgents = this.agentRegistry.getAvailableAgents();
    
    let tasksProcessed = 0;
    while (this.taskQueue.length > 0 && tasksProcessed < 10) { // Limit batch size
      const task = this.taskQueue[0];
      const suitableAgent = this.findSuitableAgent(task, availableAgents);
      if (!suitableAgent) {
        break;
      }

      try {
        await this.assignTaskToAgent(task, suitableAgent);
        this.taskQueue.shift();
        this.taskDeferrals.delete(task.id);
        tasksProcessed++;
      } catch (error) {
        const outcome = this.handleTenantQuotaDeferral(task, error as Error);
        if (outcome === 'failed') {
          this.removeTaskFromQueue(task.id);
          this.taskDeferrals.delete(task.id);
          tasksProcessed++;
          continue;
        }

        this.logger.debug('scheduler', 'Task assignment deferred', {
          taskId: task.id,
          tenantId: task.tenantId,
          reason: (error as Error).message
        });
        break;
      }
    }
  }

  private findSuitableAgent(task: Task, availableAgents: AgentId[]): AgentId | null {
    for (const agentId of availableAgents) {
      const agentMetadata = this.agentRegistry.getAgent(agentId);
      if (!agentMetadata) continue;

      // Check if agent has required capabilities
      const hasRequiredCapabilities = task.requiredCapabilities.every(reqCap =>
        agentMetadata.capabilities.some(cap => cap.name === reqCap)
      );

      if (hasRequiredCapabilities) {
        return agentId;
      }
    }

    return null;
  }

  private async assignTaskToAgent(task: Task, agentId: AgentId): Promise<void> {
    try {
      this.resourceManager?.acquireTenantTaskSlot(task.tenantId);
    } catch (error) {
      this.logger.warn('scheduler', 'Tenant quota reached, deferring assignment', {
        taskId: task.id,
        tenantId: task.tenantId,
        reason: (error as Error).message
      });
      throw error;
    }

    try {
      task.assignedTo = agentId;
      task.status = TaskStatus.ASSIGNED;

      this.pendingTasks.delete(task.id);
      this.runningTasks.set(task.id, task);

      await this.agentRegistry.assignTask(agentId, task);

      task.status = TaskStatus.RUNNING;

      this.logger.info('scheduler', 'Task assigned to agent', {
        taskId: task.id,
        agentId: agentId.id,
        tenantId: task.tenantId
      });

      this.emit('taskAssigned', task, agentId);
    } catch (error) {
      this.resourceManager?.releaseTenantTaskSlot(task.tenantId);
      this.logger.error('scheduler', 'Failed to assign task to agent', {
        taskId: task.id,
        agentId: agentId.id
      }, error as Error);

      task.status = TaskStatus.PENDING;
      task.assignedTo = undefined;
      this.runningTasks.delete(task.id);
      this.pendingTasks.set(task.id, task);
      throw error;
    }
  }

  private checkExpiredTasks(): void {
    const now = new Date();
    
    const expiredTasks = Array.from(this.runningTasks.values()).filter(
      task => task.deadline && task.deadline < now
    );

    for (const task of expiredTasks) {
      task.status = TaskStatus.FAILED;
      task.error = 'Task deadline exceeded';
      
      this.resourceManager?.releaseTenantTaskSlot(task.tenantId);
      this.runningTasks.delete(task.id);
      this.completedTasks.set(task.id, task);
      
      this.logger.warn('scheduler', 'Task expired', { taskId: task.id });
      this.emit('taskFailed', task);
    }
  }

  completeTask(taskId: string, result: any): void {
    const task = this.runningTasks.get(taskId);
    if (!task) {
      this.logger.warn('scheduler', 'Attempted to complete non-existent task', { taskId });
      return;
    }

    task.status = TaskStatus.COMPLETED;
    task.result = result;
    
    this.resourceManager?.releaseTenantTaskSlot(task.tenantId);
    this.runningTasks.delete(taskId);
    this.completedTasks.set(taskId, task);
    this.taskDeferrals.delete(taskId);
    
    this.logger.info('scheduler', 'Task completed', { taskId, tenantId: task.tenantId });
    this.emit('taskCompleted', task);
  }

  failTask(taskId: string, error: string): void {
    const task = this.runningTasks.get(taskId);
    if (!task) {
      this.logger.warn('scheduler', 'Attempted to fail non-existent task', { taskId });
      return;
    }

    task.status = TaskStatus.FAILED;
    task.error = error;
    
    this.resourceManager?.releaseTenantTaskSlot(task.tenantId);
    this.runningTasks.delete(taskId);
    this.completedTasks.set(taskId, task);
    this.taskDeferrals.delete(taskId);
    
    this.logger.warn('scheduler', 'Task failed', { taskId, error, tenantId: task.tenantId });
    this.emit('taskFailed', task);
  }

  getTask(taskId: string): Task | undefined {
    return this.pendingTasks.get(taskId) || 
           this.runningTasks.get(taskId) || 
           this.completedTasks.get(taskId);
  }

  getTasksByStatus(status: TaskStatus): Task[] {
    switch (status) {
      case TaskStatus.PENDING:
        return Array.from(this.pendingTasks.values());
      case TaskStatus.RUNNING:
        return Array.from(this.runningTasks.values());
      case TaskStatus.COMPLETED:
      case TaskStatus.FAILED:
      case TaskStatus.CANCELLED:
        return Array.from(this.completedTasks.values()).filter(t => t.status === status);
      default:
        return [];
    }
  }

  getStatus(): any {
    return {
      isRunning: this.isRunning,
      pendingTasks: this.pendingTasks.size,
      runningTasks: this.runningTasks.size,
      completedTasks: this.completedTasks.size,
      queueSize: this.taskQueue.length
    };
  }

  getTaskQueue(): Task[] {
    return [...this.taskQueue];
  }

  private handleTenantQuotaDeferral(task: Task, error: Error): 'failed' | 'deferred' | 'unhandled' {
    if (!task.tenantId) {
      return 'unhandled';
    }

    const message = error.message || '';
    if (!message.toLowerCase().includes('quota')) {
      return 'unhandled';
    }

    const now = Date.now();
    const state = this.taskDeferrals.get(task.id) ?? {
      count: 0,
      firstDeferAt: now,
      lastReason: message
    };

    state.count += 1;
    state.lastReason = message;
    if (!this.taskDeferrals.has(task.id)) {
      this.taskDeferrals.set(task.id, state);
    }

    const tenantLimit = this.resourceManager?.getTenantTaskLimit(task.tenantId);
    const elapsed = now - state.firstDeferAt;
    const shouldFail = (tenantLimit !== undefined && tenantLimit <= 0) ||
      state.count >= MAX_TASK_DEFERRAL_COUNT ||
      elapsed >= MAX_TASK_DEFERRAL_MS;

    if (!shouldFail) {
      return 'deferred';
    }

    this.failPendingTask(task, message);
    this.taskDeferrals.delete(task.id);
    return 'failed';
  }

  private failPendingTask(task: Task, reason: string): void {
    this.pendingTasks.delete(task.id);
    this.runningTasks.delete(task.id);
    this.removeTaskFromQueue(task.id);

    task.status = TaskStatus.FAILED;
    task.error = reason;
    this.completedTasks.set(task.id, task);

    this.logger.warn('scheduler', 'Task failed due to tenant quota', {
      taskId: task.id,
      tenantId: task.tenantId,
      reason
    });
    this.emit('taskFailed', task);
  }

  private removeTaskFromQueue(taskId: string): void {
    if (this.taskQueue.length === 0) {
      return;
    }
    if (this.taskQueue[0]?.id === taskId) {
      this.taskQueue.shift();
      return;
    }
    this.taskQueue = this.taskQueue.filter((queuedTask) => queuedTask.id !== taskId);
  }
}
