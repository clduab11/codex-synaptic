import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenAIResponsesClient } from '../../src/openai/client';
import { Logger, LogLevel } from '../../src/core/logger';

type ModelsListStub = {
  models: {
    list: ReturnType<typeof vi.fn>;
  };
};

function injectModelsListStub(
  client: OpenAIResponsesClient,
  implementation: () => Promise<unknown>
): ModelsListStub {
  const stub: ModelsListStub = {
    models: {
      list: vi.fn(implementation)
    }
  };

  Object.defineProperty(client as unknown as Record<string, unknown>, 'client', {
    value: stub,
    writable: true,
    configurable: true
  });

  return stub;
}

describe('OpenAIResponsesClient readiness behavior', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Logger.getInstance().setConsoleLevel(LogLevel.FATAL);
  });

  it('reports unavailable when API key is missing', async () => {
    const client = new OpenAIResponsesClient({
      defaultModel: 'gpt-5.3-codex'
    });

    expect(client.isReady()).toBe(false);
    expect(client.getUnavailableReason()).toBe('missing_api_key');
    await expect(client.listAvailableModels()).resolves.toEqual([]);
  });

  it('disables the client for the session on auth failures', async () => {
    const client = new OpenAIResponsesClient({
      apiKey: 'sk-test',
      defaultModel: 'gpt-5.3-codex'
    });

    injectModelsListStub(client, async () => {
      throw Object.assign(new Error('Incorrect API key provided.'), { status: 401 });
    });

    await expect(client.listAvailableModels()).resolves.toEqual([]);
    expect(client.isReady()).toBe(false);
    expect(client.getUnavailableReason()).toBe('invalid_credentials');
    await expect(client.createResponse({ input: 'hello' })).rejects.toThrow(
      'OpenAI client disabled for this session due to invalid credentials.'
    );
  });

  it('keeps the client available on non-auth model listing failures', async () => {
    const client = new OpenAIResponsesClient({
      apiKey: 'sk-test',
      defaultModel: 'gpt-5.3-codex'
    });

    injectModelsListStub(client, async () => {
      throw Object.assign(new Error('Upstream unavailable'), { status: 503 });
    });

    await expect(client.listAvailableModels()).resolves.toEqual([]);
    expect(client.isReady()).toBe(true);
    expect(client.getUnavailableReason()).toBeUndefined();
  });
});
