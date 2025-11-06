/**
 * Tests for activation helpers
 */
import { describe, it, expect, vi } from 'vitest';
import {
  extractComponentStatuses,
  extractAgentCounts,
  evaluateSystemHealth,
  evaluateMeshStability,
  evaluateConsensusReadiness,
  evaluateSwarmReadiness,
  evaluateAutoscalerBalance,
  buildHealthFacts,
  collectWarnings
} from '../../src/reasoning/strategies/activation-helpers.js';
import { AgentStatus } from '../../src/core/types.js';

describe('Activation Helpers', () => {
  describe('extractComponentStatuses', () => {
    it('should extract all component statuses', () => {
      const systemStatus = {
        components: {
          agentRegistry: { isRunning: true },
          taskScheduler: { isRunning: true },
          neuralMesh: { nodeCount: 5 },
          swarmCoordinator: { isOptimizing: true },
          consensusManager: { mechanism: 'raft' },
          resources: { cpuPercent: 50 }
        }
      };

      const result = extractComponentStatuses(systemStatus);

      expect(result.registryStatus).toEqual({ isRunning: true });
      expect(result.schedulerStatus).toEqual({ isRunning: true });
      expect(result.meshStatus).toEqual({ nodeCount: 5 });
      expect(result.swarmStatus).toEqual({ isOptimizing: true });
      expect(result.consensusStatus).toEqual({ mechanism: 'raft' });
      expect(result.resourceUsage).toEqual({ cpuPercent: 50 });
    });

    it('should return empty objects when components are missing', () => {
      const systemStatus = {};
      const result = extractComponentStatuses(systemStatus);

      expect(result.registryStatus).toEqual({});
      expect(result.schedulerStatus).toEqual({});
      expect(result.resourceUsage).toBeUndefined();
    });
  });

  describe('extractAgentCounts', () => {
    it('should extract agent counts from registry status', () => {
      const registryStatus = {
        statusCounts: {
          [AgentStatus.ERROR]: 2,
          [AgentStatus.OFFLINE]: 3
        },
        availableAgents: 10
      };

      const result = extractAgentCounts(registryStatus);

      expect(result.errorAgents).toBe(2);
      expect(result.offlineAgents).toBe(3);
      expect(result.availableAgents).toBe(10);
    });

    it('should default to 0 when counts are missing', () => {
      const registryStatus = {};
      const result = extractAgentCounts(registryStatus);

      expect(result.errorAgents).toBe(0);
      expect(result.offlineAgents).toBe(0);
      expect(result.availableAgents).toBe(0);
    });
  });

  describe('evaluateSystemHealth', () => {
    it('should return true when system is healthy', () => {
      const registryStatus = { isRunning: true };
      const schedulerStatus = { isRunning: true };
      const errorAgents = 0;

      const result = evaluateSystemHealth(registryStatus, schedulerStatus, errorAgents);
      expect(result).toBe(true);
    });

    it('should return false when there are error agents', () => {
      const registryStatus = { isRunning: true };
      const schedulerStatus = { isRunning: true };
      const errorAgents = 1;

      const result = evaluateSystemHealth(registryStatus, schedulerStatus, errorAgents);
      expect(result).toBe(false);
    });

    it('should return false when registry is not running', () => {
      const registryStatus = { isRunning: false };
      const schedulerStatus = { isRunning: true };
      const errorAgents = 0;

      const result = evaluateSystemHealth(registryStatus, schedulerStatus, errorAgents);
      expect(result).toBe(false);
    });
  });

  describe('evaluateMeshStability', () => {
    it('should return true when mesh is stable', () => {
      const meshStatus = {
        isRunning: true,
        nodeCount: 5,
        averageConnections: 3
      };
      const agentTarget = 6;

      const result = evaluateMeshStability(meshStatus, agentTarget);
      expect(result).toBe(true);
    });

    it('should return false when node count is too low', () => {
      const meshStatus = {
        isRunning: true,
        nodeCount: 2,
        averageConnections: 3
      };
      const agentTarget = 10;

      const result = evaluateMeshStability(meshStatus, agentTarget);
      expect(result).toBe(false);
    });

    it('should return false when average connections are too low', () => {
      const meshStatus = {
        isRunning: true,
        nodeCount: 5,
        averageConnections: 1
      };
      const agentTarget = 6;

      const result = evaluateMeshStability(meshStatus, agentTarget);
      expect(result).toBe(false);
    });
  });

  describe('evaluateConsensusReadiness', () => {
    it('should return true when consensus mechanism matches and no active proposals', () => {
      const consensusStatus = {
        mechanism: 'raft',
        activeProposals: 0
      };
      const expectedMechanism = 'raft';

      const result = evaluateConsensusReadiness(consensusStatus, expectedMechanism);
      expect(result).toBe(true);
    });

    it('should return false when mechanism does not match', () => {
      const consensusStatus = {
        mechanism: 'bft',
        activeProposals: 0
      };
      const expectedMechanism = 'raft';

      const result = evaluateConsensusReadiness(consensusStatus, expectedMechanism);
      expect(result).toBe(false);
    });

    it('should be case insensitive', () => {
      const consensusStatus = {
        mechanism: 'RAFT',
        activeProposals: 0
      };
      const expectedMechanism = 'raft';

      const result = evaluateConsensusReadiness(consensusStatus, expectedMechanism);
      expect(result).toBe(true);
    });
  });

  describe('evaluateSwarmReadiness', () => {
    it('should return true when swarm is ready', () => {
      const swarmStatus = {
        isRunning: true,
        particleCount: 5
      };
      const availableAgents = 5;

      const result = evaluateSwarmReadiness(swarmStatus, availableAgents);
      expect(result).toBe(true);
    });

    it('should return false when particle count is too low', () => {
      const swarmStatus = {
        isRunning: true,
        particleCount: 2
      };
      const availableAgents = 5;

      const result = evaluateSwarmReadiness(swarmStatus, availableAgents);
      expect(result).toBe(false);
    });
  });

  describe('evaluateAutoscalerBalance', () => {
    it('should return true when autoscaler is balanced', () => {
      const resourceUsage = {
        cpuPercent: 50,
        memoryStatus: { headroomMB: 512 },
        activeAgents: 3
      };
      const agentTarget = 5;

      const result = evaluateAutoscalerBalance(resourceUsage, agentTarget);
      expect(result).toBe(true);
    });

    it('should return false when CPU is too high', () => {
      const resourceUsage = {
        cpuPercent: 90,
        memoryStatus: { headroomMB: 512 },
        activeAgents: 3
      };
      const agentTarget = 5;

      const result = evaluateAutoscalerBalance(resourceUsage, agentTarget);
      expect(result).toBe(false);
    });

    it('should return false when memory headroom is too low', () => {
      const resourceUsage = {
        cpuPercent: 50,
        memoryStatus: { headroomMB: 100 },
        activeAgents: 3
      };
      const agentTarget = 5;

      const result = evaluateAutoscalerBalance(resourceUsage, agentTarget);
      expect(result).toBe(false);
    });
  });

  describe('buildHealthFacts', () => {
    it('should build health facts object', () => {
      const result = buildHealthFacts(true, true, true, true, true, true);

      expect(result).toEqual({
        systemHealth: true,
        meshHealth: true,
        consensusHealth: true,
        swarmReadiness: true,
        goapCoverage: true,
        autoscalerBalance: true
      });
    });
  });

  describe('collectWarnings', () => {
    it('should collect warnings for failed health checks', () => {
      const warnings = collectWarnings(
        false, // systemHealthy
        false, // meshStable
        false, // consensusReady
        false, // swarmReady
        false, // goapPrepared
        false, // autoscalerBalanced
        'raft',
        'bft',
        [],
        undefined
      );

      expect(warnings).toContain('System health check failed.');
      expect(warnings).toContain('Neural mesh topology requires attention.');
      expect(warnings).toContain('Swarm coordinator is not actively optimizing.');
      expect(warnings).toContain('GOAP manifest coverage unavailable.');
      expect(warnings).toContain('Autoscaler metrics outside desired envelope.');
    });

    it('should include GOAP warnings', () => {
      const goapWarnings = ['GOAP warning 1', 'GOAP warning 2'];
      const warnings = collectWarnings(
        true, true, true, true, true, true,
        'raft', 'raft', goapWarnings, undefined
      );

      expect(warnings).toContain('GOAP warning 1');
      expect(warnings).toContain('GOAP warning 2');
    });

    it('should include manifest path warning', () => {
      const warnings = collectWarnings(
        true, true, true, true, true, true,
        'raft', 'raft', [], '/path/to/manifest.yml'
      );

      expect(warnings).toContain('Strategy manifest loaded from /path/to/manifest.yml');
    });
  });
});
