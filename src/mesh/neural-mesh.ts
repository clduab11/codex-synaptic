/**
 * Neural Mesh implementation for interconnected agent networks
 */

import { EventEmitter } from 'events';
import { Logger } from '../core/logger.js';
import { AgentRegistry } from '../agents/registry.js';
import { NeuralMeshNode, Connection, AgentId } from '../core/types.js';

export class NeuralMesh extends EventEmitter {
  private logger = Logger.getInstance();
  private nodes: Map<string, NeuralMeshNode> = new Map();
  private topology: string = 'mesh';
  private updateInterval?: NodeJS.Timeout;
  private isRunning = false;
  private maxConnections = 5;
  private readonly updateIntervalMs = 5000;
  private maxRunDurationMs = 60 * 60 * 1000;
  private runTimeout?: NodeJS.Timeout;
  private runStartedAt?: number;
  private dynamicUpdatesActive = false;
  private supportedTopologies: Set<string> = new Set(['mesh', 'ring', 'star', 'tree', 'hybrid']);
  private selfHealingEnabled = false;
  private selfHealingIntervalMs = 15000;
  private selfHealingTimer?: NodeJS.Timeout;

  constructor(private agentRegistry: AgentRegistry) {
    super();
    this.logger.info('neural-mesh', 'Neural mesh created');
  }

  async initialize(): Promise<void> {
    this.logger.info('neural-mesh', 'Initializing neural mesh...');
    
    this.isRunning = true;
    this.activateUpdates('initialize');

    this.setupEventHandlers();
    
    this.logger.info('neural-mesh', 'Neural mesh initialized');
  }

  async shutdown(): Promise<void> {
    this.logger.info('neural-mesh', 'Shutting down neural mesh...');
    
    this.isRunning = false;

    this.stopDynamicUpdates('manual');

    this.nodes.clear();
    this.disableSelfHealing();

    this.logger.info('neural-mesh', 'Neural mesh shutdown complete');
  }

  configure(options: {
    topology?: string;
    maxConnections?: number;
    desiredNodeCount?: number;
    supportedTopologies?: string[];
    selfHealing?: {
      enabled: boolean;
      intervalMs?: number;
    };
  }): void {
    if (options.topology) {
      this.setTopology(options.topology);
    }
    if (options.maxConnections) {
      this.maxConnections = Math.max(1, options.maxConnections);
    }
    if (options.supportedTopologies?.length) {
      this.supportedTopologies = new Set(options.supportedTopologies);
      if (!this.supportedTopologies.has(this.topology)) {
        this.setTopology(options.supportedTopologies[0]);
      }
    }
    if (options.selfHealing) {
      this.configureSelfHealing(options.selfHealing.enabled, options.selfHealing.intervalMs);
    }

    if (options.desiredNodeCount && options.desiredNodeCount > this.nodes.size) {
      this.logger.debug('neural-mesh', 'Mesh has fewer nodes than desired configuration', {
        desired: options.desiredNodeCount,
        actual: this.nodes.size
      });
    }

    this.rebuildConnections();
    this.activateUpdates('configure');
  }

  private setupEventHandlers(): void {
    this.agentRegistry.on('agentRegistered', (agent: any) => {
      this.addNode(agent.id);
    });

    this.agentRegistry.on('agentUnregistered', (agentId: AgentId) => {
      this.removeNode(agentId);
    });
  }

  private addNode(agentId: AgentId): void {
    if (this.nodes.has(agentId.id)) {
      return;
    }

    const node: NeuralMeshNode = {
      agent: agentId,
      position: this.generateRandomPosition(),
      connections: [],
      state: {},
      lastUpdate: new Date()
    };

    this.nodes.set(agentId.id, node);
    this.rebuildConnections();
    
    this.logger.info('neural-mesh', 'Node added to mesh', { agentId: agentId.id });
    this.emit('nodeAdded', node);
  }

  private removeNode(agentId: AgentId): void {
    const node = this.nodes.get(agentId.id);
    if (!node) return;

    // Remove connections to this node from other nodes
    for (const otherNode of this.nodes.values()) {
      otherNode.connections = otherNode.connections.filter(
        conn => conn.target.id !== agentId.id
      );
    }

    this.nodes.delete(agentId.id);

    this.logger.info('neural-mesh', 'Node removed from mesh', { agentId: agentId.id });
    this.emit('nodeRemoved', agentId);
    this.rebuildConnections();
  }

  private generateRandomPosition(): number[] {
    return [Math.random() * 100, Math.random() * 100, Math.random() * 100];
  }

  private establishConnections(node: NeuralMeshNode): void {
    const allNodes = Array.from(this.nodes.values()).filter(n => n.agent.id !== node.agent.id);
    if (!allNodes.length) {
      return;
    }

    switch (this.topology) {
      case 'ring':
        this.establishRingConnections(node, allNodes);
        break;
      case 'star':
        this.establishStarConnections(node, allNodes);
        break;
      case 'tree':
        this.establishTreeConnections(node, allNodes);
        break;
      case 'hybrid':
        this.establishHybridConnections(node, allNodes);
        break;
      case 'mesh':
      default:
        this.establishMeshConnections(node, allNodes);
        break;
    }
  }

  private setTopology(desired: string): void {
    if (!this.supportedTopologies.has(desired)) {
      this.logger.warn('neural-mesh', 'Requested topology not supported, falling back to mesh', { desired });
      this.topology = 'mesh';
      return;
    }
    this.topology = desired;
  }

  private configureSelfHealing(enabled: boolean, intervalMs?: number): void {
    this.selfHealingEnabled = enabled;
    if (intervalMs && intervalMs >= 5000) {
      this.selfHealingIntervalMs = intervalMs;
    }
    if (this.dynamicUpdatesActive) {
      if (this.selfHealingEnabled) {
        this.enableSelfHealingLoop();
      } else {
        this.disableSelfHealing();
      }
    }
  }

  private enableSelfHealingLoop(): void {
    if (!this.selfHealingEnabled || this.selfHealingTimer) {
      return;
    }
    this.selfHealingTimer = setInterval(() => this.performSelfHealing(), this.selfHealingIntervalMs);
  }

  private disableSelfHealing(): void {
    if (this.selfHealingTimer) {
      clearInterval(this.selfHealingTimer);
      this.selfHealingTimer = undefined;
    }
  }

  private performSelfHealing(): void {
    let healingApplied = false;
    for (const node of this.nodes.values()) {
      if (node.connections.length === 0) {
        this.establishConnections(node);
        healingApplied = true;
      } else if (node.connections.length < Math.max(1, Math.floor(this.maxConnections / 2))) {
        this.establishMeshConnections(node, Array.from(this.nodes.values()).filter(n => n.agent.id !== node.agent.id));
        healingApplied = true;
      }
    }

    if (healingApplied) {
      this.logger.info('neural-mesh', 'Self-healing pass applied to topology');
      this.emit('topologyUpdated', this.getTopology());
      this.emit('selfHealingApplied', { timestamp: new Date(), topology: this.topology, nodeCount: this.nodes.size });
    }
  }

  private addConnection(node: NeuralMeshNode, target: NeuralMeshNode, weight = Math.random(), type: 'sync' | 'async' = 'async'): void {
    if (node.connections.length >= this.maxConnections) {
      return;
    }
    if (node.connections.some(conn => conn.target.id === target.agent.id)) {
      return;
    }

    node.connections.push({
      target: target.agent,
      weight,
      type,
      protocol: 'ws',
      lastActivity: new Date()
    });
  }

  private establishMeshConnections(node: NeuralMeshNode, peers: NeuralMeshNode[]): void {
    const shuffled = [...peers].sort(() => Math.random() - 0.5);
    for (const peer of shuffled) {
      if (node.connections.length >= this.maxConnections) break;
      this.addConnection(node, peer);
    }
  }

  private establishRingConnections(node: NeuralMeshNode, peers: NeuralMeshNode[]): void {
    const ordered = [...peers, node].sort((a, b) => a.agent.id.localeCompare(b.agent.id));
    const index = ordered.findIndex(n => n.agent.id === node.agent.id);
    const prev = ordered[(index - 1 + ordered.length) % ordered.length];
    const next = ordered[(index + 1) % ordered.length];
    if (prev.agent.id !== node.agent.id) {
      this.addConnection(node, prev, 0.9, 'sync');
    }
    if (next.agent.id !== node.agent.id) {
      this.addConnection(node, next, 0.9, 'sync');
    }
  }

  private establishStarConnections(node: NeuralMeshNode, peers: NeuralMeshNode[]): void {
    const hub = [...this.nodes.values()].sort((a, b) => a.agent.id.localeCompare(b.agent.id))[0];
    if (hub.agent.id === node.agent.id) {
      const favorites = peers.sort((a, b) => a.agent.id.localeCompare(b.agent.id));
      for (const peer of favorites.slice(0, this.maxConnections)) {
        this.addConnection(node, peer, 0.95, 'sync');
      }
    } else {
      this.addConnection(node, hub, 0.95, 'sync');
    }
  }

  private establishTreeConnections(node: NeuralMeshNode, peers: NeuralMeshNode[]): void {
    const ordered = [...this.nodes.values()].sort((a, b) => a.agent.id.localeCompare(b.agent.id));
    const index = ordered.findIndex(n => n.agent.id === node.agent.id);
    if (index <= 0) {
      const leftChild = ordered[1];
      const rightChild = ordered[2];
      if (leftChild) this.addConnection(node, leftChild, 0.85);
      if (rightChild) this.addConnection(node, rightChild, 0.82);
      return;
    }

    const parentIndex = Math.floor((index - 1) / 2);
    const parent = ordered[parentIndex];
    if (parent) {
      this.addConnection(node, parent, 0.88, 'sync');
    }
    const leftChildIndex = (index * 2) + 1;
    const rightChildIndex = (index * 2) + 2;
    const leftChild = ordered[leftChildIndex];
    const rightChild = ordered[rightChildIndex];
    if (leftChild) this.addConnection(node, leftChild, 0.8);
    if (rightChild) this.addConnection(node, rightChild, 0.78);
  }

  private establishHybridConnections(node: NeuralMeshNode, peers: NeuralMeshNode[]): void {
    this.establishRingConnections(node, peers);
    if (node.connections.length < this.maxConnections) {
      this.establishMeshConnections(node, peers);
    }
  }

  private rebuildConnections(): void {
    for (const node of this.nodes.values()) {
      node.connections = [];
    }

    for (const node of this.nodes.values()) {
      this.establishConnections(node);
    }

    this.emit('topologyUpdated', this.getTopology());
  }

  private updateTopology(): void {
    if (!this.isRunning || !this.dynamicUpdatesActive) return;

    // Update node states and connection weights based on activity
    for (const node of this.nodes.values()) {
      node.lastUpdate = new Date();
      
      // Update connection weights based on usage (simplified)
      for (const connection of node.connections) {
        const timeSinceActivity = Date.now() - connection.lastActivity.getTime();
        if (timeSinceActivity > 60000) { // 1 minute
          connection.weight *= 0.95; // Decay unused connections
        }
      }
    }

    if (this.selfHealingEnabled) {
      this.performSelfHealing();
    }

    this.emit('topologyUpdated', this.getTopology());
  }

  getTopology(): any {
    return {
      nodes: Array.from(this.nodes.values()),
      connections: this.getConnectionCount(),
      averageConnections: this.getAverageConnections()
    };
  }

  private getConnectionCount(): number {
    return Array.from(this.nodes.values()).reduce(
      (total, node) => total + node.connections.length, 0
    );
  }

  private getAverageConnections(): number {
    const nodeCount = this.nodes.size;
    return nodeCount > 0 ? this.getConnectionCount() / nodeCount : 0;
  }

  getNeighbors(agentId: AgentId): NeuralMeshNode[] {
    const node = this.nodes.get(agentId.id);
    if (!node) {
      return [];
    }

    return node.connections.map(conn => this.nodes.get(conn.target.id)).filter(n => n) as NeuralMeshNode[];
  }

  getStatus(): any {
    return {
      isRunning: this.isRunning,
      nodeCount: this.nodes.size,
      connectionCount: this.getConnectionCount(),
      averageConnections: this.getAverageConnections(),
      topology: this.topology,
      supportedTopologies: Array.from(this.supportedTopologies),
      runActive: this.dynamicUpdatesActive,
      runStartedAt: this.runStartedAt ? new Date(this.runStartedAt) : undefined,
      maxRunDurationMs: this.maxRunDurationMs,
      selfHealingEnabled: this.selfHealingEnabled,
      remainingTimeMs: this.runStartedAt ? Math.max(0, this.maxRunDurationMs - (Date.now() - this.runStartedAt)) : undefined
    };
  }

  setMaxRunDuration(durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      this.maxRunDurationMs = 0;
      this.clearRunTimeout();
      return;
    }

    this.maxRunDurationMs = durationMs;
    if (this.dynamicUpdatesActive) {
      this.scheduleRunTimeout();
    }
  }

  private activateUpdates(trigger: 'initialize' | 'configure' | 'manual'): void {
    if (this.updateInterval) {
      this.runStartedAt = Date.now();
      this.scheduleRunTimeout();
      return;
    }

    this.dynamicUpdatesActive = true;
    this.runStartedAt = Date.now();
    this.updateInterval = setInterval(() => {
      this.updateTopology();
    }, this.updateIntervalMs);
    this.scheduleRunTimeout();
    this.enableSelfHealingLoop();
    this.logger.info('neural-mesh', 'Topology updates activated', {
      trigger,
      maxRunDurationMs: this.maxRunDurationMs
    });
    this.emit('runStarted', { trigger, startedAt: new Date(this.runStartedAt) });
  }

  private stopDynamicUpdates(reason: 'manual' | 'timeout'): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = undefined;
    }

    this.clearRunTimeout();
    this.disableSelfHealing();

    if (!this.dynamicUpdatesActive && reason === 'manual') {
      return;
    }

    const startedAt = this.runStartedAt;
    const durationMs = startedAt ? Date.now() - startedAt : undefined;
    this.dynamicUpdatesActive = false;
    this.runStartedAt = undefined;

    if (reason === 'timeout') {
      this.logger.warn('neural-mesh', 'Topology updates stopped due to max runtime', {
        maxRunDurationMs: this.maxRunDurationMs,
        durationMs
      });
    } else {
      this.logger.info('neural-mesh', 'Topology updates stopped');
    }

    this.emit('runStopped', { reason, durationMs, startedAt: startedAt ? new Date(startedAt) : undefined });
    this.emit('topologyUpdated', this.getTopology());
  }

  private scheduleRunTimeout(): void {
    this.clearRunTimeout();

    if (!Number.isFinite(this.maxRunDurationMs) || this.maxRunDurationMs <= 0 || !this.dynamicUpdatesActive) {
      return;
    }

    this.runTimeout = setTimeout(() => {
      this.logger.warn('neural-mesh', 'Mesh orchestration exceeded configured max duration; stopping');
      this.stopDynamicUpdates('timeout');
    }, this.maxRunDurationMs);
  }

  private clearRunTimeout(): void {
    if (this.runTimeout) {
      clearTimeout(this.runTimeout);
      this.runTimeout = undefined;
    }
  }
}
