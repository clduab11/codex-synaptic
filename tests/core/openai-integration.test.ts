import { describe, expect, it, vi, beforeEach } from 'vitest';
import { CodexSynapticSystem } from '../../src/core/system';
import { OpenAIResponsesClient } from '../../src/openai/client';
import { getStaticOpenAIModelCatalog } from '../../src/openai/model-catalog';

describe('OpenAI integration workflow hooks', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('appends the OpenAI synthesis stage when the responses backend is active', () => {
    const system = new CodexSynapticSystem();
    (system as any).openaiResponsesClient = { isReady: () => true };
    (system as any).openaiResolved = {
      config: {
        enabled: true,
        defaultBackend: 'openai-responses',
        responses: { enabled: true }
      }
    };

    const stages = (system as any).buildWorkflow('Summarize AGENTS.md updates');
    const ids = stages.map((stage: any) => stage.id);

    expect(ids).toContain('openai-synthesis');
  });

  it('skips the OpenAI synthesis stage when the client is unavailable', () => {
    const system = new CodexSynapticSystem();
    (system as any).openaiResponsesClient = undefined;
    (system as any).openaiResolved = {
      config: {
        enabled: true,
        defaultBackend: 'openai-responses',
        responses: { enabled: true }
      }
    };

    const stages = (system as any).buildWorkflow('Summarize AGENTS.md updates');
    const ids = stages.map((stage: any) => stage.id);

    expect(ids).not.toContain('openai-synthesis');
  });

  it('persists OpenAI responses to memory with tenant metadata', async () => {
    const system = new CodexSynapticSystem();
    const storeMock = vi.fn().mockResolvedValue(1);
    (system as any).memorySystem = { store: storeMock };

    const createResponseMock = vi.fn().mockResolvedValue({
      output_text: JSON.stringify({
        summary: 'All tasks complete.',
        finalAnswer: 'Deployment ready.',
        keyPoints: ['Validated drift guards']
      })
    });

    (system as any).openaiResponsesClient = {
      isReady: () => true,
      createResponse: createResponseMock
    };

    const stage = {
      id: 'openai-synthesis',
      label: 'OpenAI Synthesis',
      taskType: 'openai_responses'
    };

    const payload = { prompt: 'Summarize the sprint' };
    const context = { prompt: 'Summarize the sprint', stageResults: {} };

    const result = await (system as any).executeStageWithOpenAIResponses(
      stage,
      payload,
      context,
      { tenantId: 'tenant-123' }
    );

    expect(result.summary).toBe('All tasks complete.');

    expect(storeMock).toHaveBeenCalledTimes(1);
    const [namespace, key, storedPayload, options] = storeMock.mock.calls[0];
    expect(namespace).toBe('openai_responses');
    expect(key).toMatch(/^stage-openai-synthesis-/);
    expect(storedPayload.stage).toBe('openai-synthesis');
    expect(options).toEqual({ tenantId: 'tenant-123' });

    expect(createResponseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { workflowStage: 'openai-synthesis' }
      })
    );
  });

  it('propagates the OpenAI final answer into the workflow outcome', () => {
    const system = new CodexSynapticSystem();
    const context = {
      prompt: 'Summarize system status',
      stageResults: {
        'openai-synthesis': {
          result: {
            summary: 'OpenAI synthesis completed.',
            finalAnswer: 'System ready for release.'
          }
        }
      }
    };

    const outcome = (system as any).buildWorkflowOutcome(
      context.prompt,
      context,
      []
    );

    expect(outcome.finalAnswer).toBe('System ready for release.');
    expect(outcome.artifacts.openaiSynthesis.summary).toBe('OpenAI synthesis completed.');
  });

  it('requires consensus for high-risk prompts but not routine ones', () => {
    const system = new CodexSynapticSystem();
    const risky = (system as any).shouldRequireConsensusForPrompt(
      'Deploy the production hotfix immediately with rollback plan.'
    );
    const routine = (system as any).shouldRequireConsensusForPrompt(
      'Compile documentation updates for the upcoming release.'
    );

    expect(risky).toBe(true);
    expect(routine).toBe(false);
  });

  it('initializes router fallback when OpenAI auth fails during startup validation', async () => {
    const system = new CodexSynapticSystem();
    const originalApiKey = process.env.OPENAI_API_KEY;
    const catalogSnapshot = {
      fetchedAt: new Date('2026-01-01T00:00:00.000Z'),
      models: getStaticOpenAIModelCatalog()
    };

    process.env.OPENAI_API_KEY = 'sk-proj-invalid-key';
    (system as any).config = {
      openai: {
        enabled: true,
        defaultBackend: 'openai-responses',
        credentials: { apiKeyEnv: 'OPENAI_API_KEY' },
        responses: { enabled: true }
      }
    };

    const isReadySpy = vi
      .spyOn(OpenAIResponsesClient.prototype, 'isReady')
      .mockReturnValueOnce(true)
      .mockReturnValue(false);
    const catalogSpy = vi
      .spyOn(OpenAIResponsesClient.prototype, 'getModelCatalogSnapshot')
      .mockResolvedValue(catalogSnapshot);

    try {
      await (system as any).initializeOpenAIIntegration();

      expect(catalogSpy).toHaveBeenCalledTimes(1);
      expect(isReadySpy).toHaveBeenCalled();
      expect((system as any).openaiResponsesClient).toBeUndefined();
      expect((system as any).openaiModelRouter).toBeDefined();

      const selection = await (system as any).openaiModelRouter.selectModel({
        prompt: 'Summarize the release status',
        stageId: 'openai-synthesis',
        stageLabel: 'OpenAI Synthesis'
      });
      expect(selection.model).toBe('gpt-5-codex');
    } finally {
      if (originalApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = originalApiKey;
      }
    }
  });
});
