/**
 * Swarm Coordinator for multi-agent coordination and optimization
 */

import { EventEmitter } from 'events';
import { Logger } from '../core/logger.js';
import { AgentRegistry } from '../agents/registry.js';
import { SwarmConfiguration, AgentId } from '../core/types.js';

export class SwarmCoordinator extends EventEmitter {
  private logger = Logger.getInstance();
  private isRunning = false;
  private currentConfiguration?: SwarmConfiguration;
  private optimizationInterval?: NodeJS.Timeout;
  private particles: Map<string, SwarmParticle> = new Map();
  private pheromoneMatrix: Map<string, number> = new Map();
  private maxRunDurationMs = 60 * 60 * 1000;
  private runTimeout?: NodeJS.Timeout;
  private runStartedAt?: number;

  constructor(private agentRegistry: AgentRegistry) {
    super();
    this.logger.info('swarm', 'Swarm coordinator created');
  }

  async initialize(): Promise<void> {
    this.logger.info('swarm', 'Initializing swarm coordinator...');
    
    this.isRunning = true;
    this.setupEventHandlers();
    
    this.logger.info('swarm', 'Swarm coordinator initialized');
  }

  async shutdown(): Promise<void> {
    this.logger.info('swarm', 'Shutting down swarm coordinator...');
    
    this.isRunning = false;
    
    if (this.optimizationInterval) {
      clearInterval(this.optimizationInterval);
      this.optimizationInterval = undefined;
    }

    this.clearRunTimeout();
    this.runStartedAt = undefined;

    this.particles.clear();
    this.pheromoneMatrix.clear();
    
    this.logger.info('swarm', 'Swarm coordinator shutdown complete');
  }

  private setupEventHandlers(): void {
    this.agentRegistry.on('agentRegistered', (agent: any) => {
      this.addParticle(agent.id);
    });

    this.agentRegistry.on('agentUnregistered', (agentId: AgentId) => {
      this.removeParticle(agentId);
    });
  }

  startSwarm(config: SwarmConfiguration): void {
    this.currentConfiguration = config;
    this.pheromoneMatrix.clear();

    if (this.optimizationInterval) {
      this.logger.warn('swarm', 'Swarm already active; restarting with new configuration');
      this.stopSwarm('manual');
    }

    this.logger.info('swarm', 'Starting swarm optimization', { 
      algorithm: config.algorithm,
      objectives: config.objectives
    });

    // Initialize particles for all agents
    const agents = this.agentRegistry.getAllAgents();
    for (const agent of agents) {
      this.addParticle(agent.id);
    }

    // Start optimization loop
    this.optimizationInterval = setInterval(() => {
      this.performOptimizationStep();
    }, 1000);

    this.runStartedAt = Date.now();
    this.scheduleRunTimeout();

    this.emit('swarmStarted', config);
  }

  stopSwarm(reason: 'manual' | 'timeout' = 'manual'): void {
    if (this.optimizationInterval) {
      clearInterval(this.optimizationInterval);
      this.optimizationInterval = undefined;
    }

    this.clearRunTimeout();

    this.particles.clear();
    this.currentConfiguration = undefined;

    const startedAt = this.runStartedAt;
    const durationMs = startedAt ? Date.now() - startedAt : undefined;
    this.runStartedAt = undefined;

    if (reason === 'timeout') {
      this.logger.warn('swarm', 'Swarm optimization stopped due to max runtime', {
        maxRunDurationMs: this.maxRunDurationMs,
        durationMs
      });
    } else {
      this.logger.info('swarm', 'Swarm optimization stopped');
    }

    this.emit('swarmStopped', { reason, durationMs, startedAt: startedAt ? new Date(startedAt) : undefined });
    if (reason === 'timeout') {
      this.emit('swarmTimeout', { durationMs, maxRunDurationMs: this.maxRunDurationMs });
    }
  }

  private addParticle(agentId: AgentId): void {
    if (!this.currentConfiguration || this.particles.has(agentId.id)) {
      return;
    }

    const particle: SwarmParticle = {
      agentId,
      position: this.generateRandomPosition(),
      velocity: this.generateRandomVelocity(),
      bestPosition: this.generateRandomPosition(),
      bestFitness: -Infinity,
      fitness: 0
    };

    this.particles.set(agentId.id, particle);
    
    this.logger.debug('swarm', 'Particle added to swarm', { agentId: agentId.id });

    for (const other of this.particles.values()) {
      if (other.agentId.id === agentId.id) {
        continue;
      }
      const key = this.getEdgeKey(agentId.id, other.agentId.id);
      if (!this.pheromoneMatrix.has(key)) {
        const base = Number(this.currentConfiguration?.parameters?.initialPheromone ?? 1);
        this.pheromoneMatrix.set(key, base);
      }
    }
  }

  private removeParticle(agentId: AgentId): void {
    this.particles.delete(agentId.id);
    this.logger.debug('swarm', 'Particle removed from swarm', { agentId: agentId.id });
  }

  private performOptimizationStep(): void {
    if (!this.currentConfiguration || this.particles.size === 0) {
      return;
    }

    switch (this.currentConfiguration.algorithm) {
      case 'pso':
        this.performPSOStep();
        break;
      case 'aco':
        this.performACOStep();
        break;
      case 'flocking':
        this.performFlockingStep();
        break;
      case 'hybrid':
        this.performHybridStep();
        break;
      default:
        this.logger.warn('swarm', 'Unknown swarm algorithm', { 
          algorithm: this.currentConfiguration.algorithm 
        });
    }
  }

  private performPSOStep(): void {
    const config = this.currentConfiguration!;
    const w = config.parameters.inertiaWeight || 0.5;
    const c1 = config.parameters.cognitiveCoeff || 1.5;
    const c2 = config.parameters.socialCoeff || 1.5;

    // Find global best position
    const globalBest = this.findGlobalBest();

    for (const particle of this.particles.values()) {
      // Calculate fitness
      particle.fitness = this.calculateFitness(particle);
      
      // Update personal best
      if (particle.fitness > particle.bestFitness) {
        particle.bestFitness = particle.fitness;
        particle.bestPosition = [...particle.position];
      }

      // Update velocity and position
      for (let i = 0; i < particle.position.length; i++) {
        const r1 = Math.random();
        const r2 = Math.random();
        
        particle.velocity[i] = w * particle.velocity[i] +
                              c1 * r1 * (particle.bestPosition[i] - particle.position[i]) +
                              c2 * r2 * (globalBest.position[i] - particle.position[i]);
        
        particle.position[i] += particle.velocity[i];
        
        // Apply bounds
        particle.position[i] = Math.max(-100, Math.min(100, particle.position[i]));
      }
    }

    this.logger.debug('swarm', 'PSO step completed', { 
      particles: this.particles.size,
      globalBestFitness: globalBest.fitness
    });
  }

  private performACOStep(): void {
    if (!this.currentConfiguration || this.particles.size < 2) {
      return;
    }

    const evaporationRate = Number(this.currentConfiguration.parameters.pheromoneEvaporation ?? 0.05);
    const minPheromone = Number(this.currentConfiguration.parameters.minPheromone ?? 0.01);
    const depositScale = Number(this.currentConfiguration.parameters.pheromoneDeposit ?? 1);

    for (const [edge, level] of this.pheromoneMatrix.entries()) {
      const evaporated = level * (1 - evaporationRate);
      this.pheromoneMatrix.set(edge, Math.max(minPheromone, evaporated));
    }

    const particles = Array.from(this.particles.values());
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const a = particles[i];
        const b = particles[j];
        const distance = this.calculateDistance(a.position, b.position) + 1e-3;
        const bestFitness = Math.max(a.bestFitness, b.bestFitness, 0);
        const deposit = depositScale / distance + Math.max(0, bestFitness);
        const key = this.getEdgeKey(a.agentId.id, b.agentId.id);
        this.pheromoneMatrix.set(key, (this.pheromoneMatrix.get(key) ?? minPheromone) + deposit);
      }
    }

    this.logger.debug('swarm', 'ACO step completed', {
      pheromoneEdges: this.pheromoneMatrix.size
    });
  }

  private performHybridStep(): void {
    this.performPSOStep();
    this.performACOStep();

    if (!this.currentConfiguration) {
      return;
    }

    const influence = Number(this.currentConfiguration.parameters.pheromoneInfluence ?? 0.18);
    const damping = Number(this.currentConfiguration.parameters.hybridDamping ?? 0.45);

    for (const particle of this.particles.values()) {
      const bestNeighbor = this.findHighestPheromoneNeighbor(particle);
      if (!bestNeighbor) {
        continue;
      }
      for (let i = 0; i < particle.position.length; i++) {
        const delta = bestNeighbor.position[i] - particle.position[i];
        particle.velocity[i] = damping * particle.velocity[i] + influence * delta;
        particle.position[i] += particle.velocity[i];
      }
      particle.bestFitness = Math.max(particle.bestFitness, this.calculateFitness(particle));
    }

    this.logger.debug('swarm', 'Hybrid step completed', {
      particles: this.particles.size
    });
  }

  private performFlockingStep(): void {
    // Simplified flocking implementation
    const separationRadius = 10;
    const cohesionRadius = 30;

    for (const particle of this.particles.values()) {
      const neighbors = this.findNeighbors(particle, cohesionRadius);
      
      const separation = this.calculateSeparation(particle, neighbors, separationRadius);
      const alignment = this.calculateAlignment(particle, neighbors);
      const cohesion = this.calculateCohesion(particle, neighbors);

      // Combine forces
      for (let i = 0; i < particle.velocity.length; i++) {
        particle.velocity[i] = 0.5 * particle.velocity[i] +
                              0.2 * separation[i] +
                              0.1 * alignment[i] +
                              0.2 * cohesion[i];
        
        particle.position[i] += particle.velocity[i];
      }
    }

    this.logger.debug('swarm', 'Flocking step completed');
  }

  private generateRandomPosition(): number[] {
    return [
      Math.random() * 200 - 100, // x: -100 to 100
      Math.random() * 200 - 100, // y: -100 to 100
      Math.random() * 200 - 100  // z: -100 to 100
    ];
  }

  private generateRandomVelocity(): number[] {
    return [
      Math.random() * 10 - 5, // vx: -5 to 5
      Math.random() * 10 - 5, // vy: -5 to 5
      Math.random() * 10 - 5  // vz: -5 to 5
    ];
  }

  private calculateFitness(particle: SwarmParticle): number {
    // Simplified fitness function - would be problem-specific
    return -Math.sqrt(
      particle.position[0] * particle.position[0] +
      particle.position[1] * particle.position[1] +
      particle.position[2] * particle.position[2]
    );
  }

  private findGlobalBest(): SwarmParticle {
    let bestParticle = Array.from(this.particles.values())[0];
    let bestFitness = bestParticle?.bestFitness || -Infinity;

    for (const particle of this.particles.values()) {
      if (particle.bestFitness > bestFitness) {
        bestFitness = particle.bestFitness;
        bestParticle = particle;
      }
    }

    return bestParticle;
  }

  private findNeighbors(particle: SwarmParticle, radius: number): SwarmParticle[] {
    const neighbors: SwarmParticle[] = [];
    
    for (const other of this.particles.values()) {
      if (other.agentId.id === particle.agentId.id) continue;
      
      const distance = this.calculateDistance(particle.position, other.position);
      if (distance <= radius) {
        neighbors.push(other);
      }
    }
    
    return neighbors;
  }

  private calculateDistance(pos1: number[], pos2: number[]): number {
    let sum = 0;
    for (let i = 0; i < pos1.length; i++) {
      sum += (pos1[i] - pos2[i]) ** 2;
    }
    return Math.sqrt(sum);
  }

  private getEdgeKey(a: string, b: string): string {
    return a < b ? `${a}::${b}` : `${b}::${a}`;
  }

  private findHighestPheromoneNeighbor(particle: SwarmParticle): SwarmParticle | undefined {
    let bestNeighbor: SwarmParticle | undefined;
    let highestPheromone = 0;
    for (const neighbor of this.particles.values()) {
      if (neighbor.agentId.id === particle.agentId.id) {
        continue;
      }
      const key = this.getEdgeKey(particle.agentId.id, neighbor.agentId.id);
      const pheromone = this.pheromoneMatrix.get(key) ?? 0;
      if (pheromone > highestPheromone) {
        highestPheromone = pheromone;
        bestNeighbor = neighbor;
      }
    }
    return bestNeighbor;
  }

  private calculateSeparation(particle: SwarmParticle, neighbors: SwarmParticle[], radius: number): number[] {
    const separation = [0, 0, 0];
    let count = 0;

    for (const neighbor of neighbors) {
      const distance = this.calculateDistance(particle.position, neighbor.position);
      if (distance < radius && distance > 0) {
        for (let i = 0; i < separation.length; i++) {
          separation[i] += (particle.position[i] - neighbor.position[i]) / distance;
        }
        count++;
      }
    }

    if (count > 0) {
      for (let i = 0; i < separation.length; i++) {
        separation[i] /= count;
      }
    }

    return separation;
  }

  private calculateAlignment(particle: SwarmParticle, neighbors: SwarmParticle[]): number[] {
    const alignment = [0, 0, 0];
    
    if (neighbors.length > 0) {
      for (const neighbor of neighbors) {
        for (let i = 0; i < alignment.length; i++) {
          alignment[i] += neighbor.velocity[i];
        }
      }
      
      for (let i = 0; i < alignment.length; i++) {
        alignment[i] /= neighbors.length;
        alignment[i] -= particle.velocity[i];
      }
    }

    return alignment;
  }

  private calculateCohesion(particle: SwarmParticle, neighbors: SwarmParticle[]): number[] {
    const cohesion = [0, 0, 0];
    
    if (neighbors.length > 0) {
      for (const neighbor of neighbors) {
        for (let i = 0; i < cohesion.length; i++) {
          cohesion[i] += neighbor.position[i];
        }
      }
      
      for (let i = 0; i < cohesion.length; i++) {
        cohesion[i] /= neighbors.length;
        cohesion[i] -= particle.position[i];
      }
    }

    return cohesion;
  }

  getStatus(): any {
    return {
      isRunning: this.isRunning,
      particleCount: this.particles.size,
      algorithm: this.currentConfiguration?.algorithm || 'none',
      isOptimizing: !!this.optimizationInterval,
      runStartedAt: this.runStartedAt ? new Date(this.runStartedAt) : undefined,
      maxRunDurationMs: this.maxRunDurationMs,
      remainingTimeMs: this.runStartedAt ? Math.max(0, this.maxRunDurationMs - (Date.now() - this.runStartedAt)) : undefined
    };
  }

  getParticle(agentId: AgentId): SwarmParticle | undefined {
    return this.particles.get(agentId.id);
  }

  setMaxRunDuration(durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      this.maxRunDurationMs = 0;
      this.clearRunTimeout();
      return;
    }

    this.maxRunDurationMs = durationMs;
    if (this.runStartedAt) {
      this.scheduleRunTimeout();
    }
  }

  private scheduleRunTimeout(): void {
    this.clearRunTimeout();
    if (!this.runStartedAt) {
      this.runStartedAt = Date.now();
    }

    if (!Number.isFinite(this.maxRunDurationMs) || this.maxRunDurationMs <= 0) {
      return;
    }

    this.runTimeout = setTimeout(() => {
      this.logger.warn('swarm', 'Swarm run exceeded configured max duration; stopping');
      this.stopSwarm('timeout');
    }, this.maxRunDurationMs);
  }

  private clearRunTimeout(): void {
    if (this.runTimeout) {
      clearTimeout(this.runTimeout);
      this.runTimeout = undefined;
    }
  }
}

export interface SwarmParticle {
  agentId: AgentId;
  position: number[];
  velocity: number[];
  bestPosition: number[];
  bestFitness: number;
  fitness: number;
}
