/**
 * Tests for tenant quota helpers
 */
import { describe, it, expect } from 'vitest';
import {
  hasQuotaFlags,
  validateQuotaOptions,
  parseMaxConcurrent,
  parseCpu,
  parseMemory,
  buildQuotaFromOptions,
  buildPolicyInput
} from '../../src/cli/tenant-quota-helpers.js';

describe('Tenant Quota Helpers', () => {
  describe('hasQuotaFlags', () => {
    it('should return true when clear flag is set', () => {
      expect(hasQuotaFlags({ clear: true })).toBe(true);
    });

    it('should return true when maxConcurrent is set', () => {
      expect(hasQuotaFlags({ maxConcurrent: '10' })).toBe(true);
    });

    it('should return true when cpu is set', () => {
      expect(hasQuotaFlags({ cpu: '50' })).toBe(true);
    });

    it('should return true when memory is set', () => {
      expect(hasQuotaFlags({ memory: '1024' })).toBe(true);
    });

    it('should return false when no flags are set', () => {
      expect(hasQuotaFlags({})).toBe(false);
    });
  });

  describe('validateQuotaOptions', () => {
    it('should return error when no flags are provided', () => {
      const result = validateQuotaOptions({});

      expect(result.hasQuotaFlags).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should return error when clear is combined with quota values', () => {
      const result = validateQuotaOptions({
        clear: true,
        maxConcurrent: '10'
      });

      expect(result.hasQuotaFlags).toBe(true);
      expect(result.error).toContain('Cannot combine');
    });

    it('should return valid result when only clear is set', () => {
      const result = validateQuotaOptions({ clear: true });

      expect(result.hasQuotaFlags).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should return valid result when quota values are set', () => {
      const result = validateQuotaOptions({
        maxConcurrent: '10',
        cpu: '50'
      });

      expect(result.hasQuotaFlags).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });

  describe('parseMaxConcurrent', () => {
    it('should parse valid maxConcurrent', () => {
      expect(parseMaxConcurrent('10')).toBe(10);
    });

    it('should accept zero', () => {
      expect(parseMaxConcurrent('0')).toBe(0);
    });

    it('should throw error for negative values', () => {
      expect(() => parseMaxConcurrent('-1')).toThrow('non-negative');
    });

    it('should throw error for non-numeric values', () => {
      expect(() => parseMaxConcurrent('abc')).toThrow('integer');
    });
  });

  describe('parseCpu', () => {
    it('should parse valid CPU percentage', () => {
      expect(parseCpu('50')).toBe(50);
    });

    it('should parse decimal values', () => {
      expect(parseCpu('25.5')).toBe(25.5);
    });

    it('should throw error for values above 100', () => {
      expect(() => parseCpu('101')).toThrow('between 0 and 100');
    });

    it('should throw error for zero or negative values', () => {
      expect(() => parseCpu('0')).toThrow('between 0 and 100');
      expect(() => parseCpu('-10')).toThrow('between 0 and 100');
    });

    it('should throw error for non-numeric values', () => {
      expect(() => parseCpu('abc')).toThrow('between 0 and 100');
    });
  });

  describe('parseMemory', () => {
    it('should parse valid memory value', () => {
      expect(parseMemory('1024')).toBe(1024);
    });

    it('should parse decimal values', () => {
      expect(parseMemory('512.5')).toBe(512.5);
    });

    it('should throw error for zero or negative values', () => {
      expect(() => parseMemory('0')).toThrow('greater than 0');
      expect(() => parseMemory('-100')).toThrow('greater than 0');
    });

    it('should throw error for non-numeric values', () => {
      expect(() => parseMemory('abc')).toThrow('greater than 0');
    });
  });

  describe('buildQuotaFromOptions', () => {
    it('should build quota with maxConcurrent', () => {
      const result = buildQuotaFromOptions({ maxConcurrent: '10' });

      expect(result.maxConcurrentTasks).toBe(10);
    });

    it('should build quota with cpu', () => {
      const result = buildQuotaFromOptions({ cpu: '50' });

      expect(result.cpuLimitPercent).toBe(50);
    });

    it('should build quota with memory', () => {
      const result = buildQuotaFromOptions({ memory: '1024' });

      expect(result.memoryLimitMb).toBe(1024);
    });

    it('should build quota with all fields', () => {
      const result = buildQuotaFromOptions({
        maxConcurrent: '10',
        cpu: '50',
        memory: '1024'
      });

      expect(result.maxConcurrentTasks).toBe(10);
      expect(result.cpuLimitPercent).toBe(50);
      expect(result.memoryLimitMb).toBe(1024);
    });

    it('should throw error when no fields are provided', () => {
      expect(() => buildQuotaFromOptions({})).toThrow('No quota fields provided');
    });
  });

  describe('buildPolicyInput', () => {
    it('should build policy input with clear flag', () => {
      const result = buildPolicyInput('tenant-1', { clear: true });

      expect(result.tenantId).toBe('tenant-1');
      expect(result.quota).toBeNull();
    });

    it('should build policy input with quota values', () => {
      const result = buildPolicyInput('tenant-1', {
        maxConcurrent: '10',
        cpu: '50'
      });

      expect(result.tenantId).toBe('tenant-1');
      expect(result.quota).toBeDefined();
      expect(result.quota?.maxConcurrentTasks).toBe(10);
      expect(result.quota?.cpuLimitPercent).toBe(50);
    });
  });
});
