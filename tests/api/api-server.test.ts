import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiServer } from '../../src/core/api-server';
import type { ToolCandidate } from '../../src/tools/optimizer';

const buildServer = () =>
  new ApiServer({
    evaluateTools: async (_prompt: string, candidates: ToolCandidate[]) =>
      candidates.map((candidate, index) => ({
        toolId: candidate.id,
        score: 0.9 - index * 0.1,
        confidence: 0.85,
        reasoning: ['Mock recommendation'],
        signals: ['code:0.5']
      }))
  });

describe('ApiServer', () => {
  let server: ApiServer;
  let port: number;

  beforeEach(async () => {
    server = buildServer();
    await server.start({ host: '127.0.0.1', port: 0, cors: { enabled: false, origins: [] } });
    const address = server.getAddress();
    if (!address) {
      throw new Error('Server address unavailable');
    }
    const match = address.match(/:(\d+)$/);
    if (!match) {
      throw new Error(`Unable to parse server port from address ${address}`);
    }
    port = Number(match[1]);
  });

  afterEach(async () => {
    await server.stop();
  });

  it('scores tool candidates via POST /v1/tools/score', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/v1/tools/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'Implement authentication module',
        candidates: [{ id: 'code-generator' }]
      })
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(Array.isArray(payload.scores)).toBe(true);
    expect(payload.scores[0].toolId).toBe('code-generator');
  });

  it('validates incoming payloads', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/v1/tools/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error).toBeDefined();
  });
});
