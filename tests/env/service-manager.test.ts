import { describe, expect, it } from 'vitest';
import { serviceManager } from '../../src/env/service-manager';

describe('serviceManager profiles', () => {
  it('lists known profiles', () => {
    const profiles = serviceManager.listProfiles();
    expect(profiles.length).toBeGreaterThan(0);
    expect(profiles.some(({ name }) => name === 'observability')).toBe(true);
  });

  it('returns profile details', () => {
    const profile = serviceManager.getProfile('qdrant');
    expect(profile.composeFile).toContain('docker/vector');
  });

  it('plan includes select profiles', () => {
    const plan = serviceManager.plan(['qdrant', 'redis']);
    expect(plan.map((item) => item.name)).toEqual(['qdrant', 'redis']);
  });
});
