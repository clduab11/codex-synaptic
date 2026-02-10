/**
 * GUI API Client
 * 
 * Client for communication between the Electron renderer process
 * and the Codex-Synaptic backend system.
 */

import type {
  GuiSystemStatus,
} from './types.js';

/**
 * Agent metadata type for GUI display
 */
interface AgentInfo {
  id: string;
  type: string;
  status: string;
  capabilities?: string[];
}

/**
 * Generate a unique request ID
 */
function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * API client configuration
 */
export interface ApiClientConfig {
  baseUrl: string;
  port: number;
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
}

/**
 * Default API client configuration
 */
const defaultConfig: ApiClientConfig = {
  baseUrl: 'http://localhost',
  port: 4242,
  timeout: 30000,
  retryAttempts: 3,
  retryDelay: 1000,
};

/**
 * GUI API Client class
 * 
 * Provides methods for the renderer process to interact with
 * the Codex-Synaptic system through HTTP API calls.
 */
export class GuiApiClient {
  private config: ApiClientConfig;
  private abortController: AbortController | null = null;
  
  constructor(config: Partial<ApiClientConfig> = {}) {
    this.config = { ...defaultConfig, ...config };
  }
  
  /**
   * Get the full API URL
   */
  private getUrl(path: string): string {
    return `${this.config.baseUrl}:${this.config.port}/api${path}`;
  }
  
  /**
   * Make an API request with retry logic
   */
  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown
  ): Promise<T> {
    const { timeout, retryAttempts, retryDelay } = this.config;
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt < (retryAttempts ?? 1); attempt++) {
      try {
        this.abortController = new AbortController();
        const timeoutId = setTimeout(() => this.abortController?.abort(), timeout);
        
        const response = await fetch(this.getUrl(path), {
          method,
          headers: {
            'Content-Type': 'application/json',
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: this.abortController.signal,
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        return await response.json() as T;
      } catch (error) {
        lastError = error as Error;
        
        if ((error as Error).name === 'AbortError') {
          throw new Error('Request timeout');
        }
        
        if (attempt < (retryAttempts ?? 1) - 1) {
          await this.delay(retryDelay ?? 1000);
        }
      }
    }
    
    throw lastError ?? new Error('Request failed');
  }
  
  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * Cancel any pending requests
   */
  cancel(): void {
    this.abortController?.abort();
  }
  
  // System endpoints
  
  /**
   * Get system status
   */
  async getSystemStatus(): Promise<GuiSystemStatus> {
    return this.request<GuiSystemStatus>('GET', '/system/status');
  }
  
  /**
   * Get system health
   */
  async getSystemHealth(): Promise<{ healthy: boolean; checks: Record<string, boolean> }> {
    return this.request('GET', '/health');
  }
  
  // Agent endpoints
  
  /**
   * Get all agents
   */
  async getAgents(): Promise<AgentInfo[]> {
    return this.request<AgentInfo[]>('GET', '/agents');
  }
  
  /**
   * Get agent by ID
   */
  async getAgent(agentId: string): Promise<AgentInfo> {
    return this.request<AgentInfo>('GET', `/agents/${agentId}`);
  }
  
  /**
   * Deploy new agents
   */
  async deployAgent(type: string, count: number): Promise<{ deployed: number; agentIds: string[] }> {
    return this.request('POST', '/agents/deploy', { type, count });
  }
  
  // Task endpoints
  
  /**
   * Submit a new task
   */
  async submitTask(prompt: string, options?: { priority?: number; tenantId?: string }): Promise<{ taskId: string }> {
    return this.request('POST', '/tasks', { prompt, ...options });
  }
  
  /**
   * Get recent tasks
   */
  async getTasks(limit?: number): Promise<Array<{
    id: string;
    prompt: string;
    status: string;
    createdAt: string;
  }>> {
    const query = limit ? `?limit=${limit}` : '';
    return this.request('GET', `/tasks${query}`);
  }
  
  /**
   * Get task by ID
   */
  async getTask(taskId: string): Promise<{
    id: string;
    prompt: string;
    status: string;
    result?: unknown;
    error?: string;
  }> {
    return this.request('GET', `/tasks/${taskId}`);
  }
  
  // Mesh endpoints
  
  /**
   * Get mesh status
   */
  async getMeshStatus(): Promise<{
    nodeCount: number;
    connectionCount: number;
    topology: string;
    health: string;
  }> {
    return this.request('GET', '/mesh/status');
  }
  
  /**
   * Configure mesh
   */
  async configureMesh(options: { nodes?: number; topology?: string }): Promise<void> {
    return this.request('POST', '/mesh/configure', options);
  }
  
  // Swarm endpoints
  
  /**
   * Get swarm status
   */
  async getSwarmStatus(): Promise<{
    active: boolean;
    algorithm?: string;
    agents?: number;
    iteration?: number;
    objectives?: string[];
  }> {
    return this.request('GET', '/swarm/status');
  }
  
  /**
   * Start swarm
   */
  async startSwarm(algorithm: string, objectives?: string[]): Promise<void> {
    return this.request('POST', '/swarm/start', { algorithm, objectives });
  }
  
  /**
   * Stop swarm
   */
  async stopSwarm(): Promise<void> {
    return this.request('POST', '/swarm/stop', {});
  }
  
  // Consensus endpoints
  
  /**
   * Get consensus status
   */
  async getConsensusStatus(): Promise<{
    activeProposals: number;
    mode: string;
    recentDecisions: number;
  }> {
    return this.request('GET', '/consensus/status');
  }
  
  /**
   * Get active proposals
   */
  async getProposals(): Promise<Array<{
    id: string;
    type: string;
    proposer: string;
    status: string;
    votes: { for: number; against: number };
  }>> {
    return this.request('GET', '/consensus/proposals');
  }
  
  /**
   * Create a proposal
   */
  async proposeConsensus(type: string, data: unknown): Promise<{ proposalId: string }> {
    return this.request('POST', '/consensus/propose', { type, data });
  }
  
  /**
   * Vote on a proposal
   */
  async voteConsensus(proposalId: string, vote: boolean): Promise<void> {
    return this.request('POST', `/consensus/vote/${proposalId}`, { vote });
  }
  
  // Memory endpoints
  
  /**
   * Get memory status
   */
  async getMemoryStatus(): Promise<{
    initialized: boolean;
    entryCount: number;
    namespaces: string[];
  }> {
    return this.request('GET', '/memory/status');
  }
  
  /**
   * List memory entries
   */
  async listMemoryEntries(namespace: string, limit?: number): Promise<Array<{
    id: number;
    namespace: string;
    key: string;
    preview: string;
    createdAt: string;
  }>> {
    const query = limit ? `?limit=${limit}` : '';
    return this.request('GET', `/memory/${namespace}${query}`);
  }
  
  // Hive-mind endpoints
  
  /**
   * Spawn hive-mind task
   */
  async spawnHiveMind(prompt: string, options?: {
    strategy?: string;
    agents?: number;
    timeout?: number;
  }): Promise<{ taskId: string; strategy: string }> {
    return this.request('POST', '/hive-mind/spawn', { prompt, ...options });
  }
  
  /**
   * Get hive-mind status
   */
  async getHiveMindStatus(): Promise<{
    active: boolean;
    strategy?: string;
    agents?: number;
    progress?: number;
  }> {
    return this.request('GET', '/hive-mind/status');
  }
}

/**
 * Singleton instance
 */
let apiClientInstance: GuiApiClient | null = null;

/**
 * Get or create the API client instance
 */
export function getApiClient(config?: Partial<ApiClientConfig>): GuiApiClient {
  if (!apiClientInstance) {
    apiClientInstance = new GuiApiClient(config);
  }
  return apiClientInstance;
}

/**
 * Reset the API client (mainly for testing)
 */
export function resetApiClient(): void {
  if (apiClientInstance) {
    apiClientInstance.cancel();
    apiClientInstance = null;
  }
}
