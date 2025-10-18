import { describe, expect, it, vi, beforeEach } from 'vitest';
import { CodexSynapticSystem } from '../../src/core/system';

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
});
