/**
 * Tests for workflow helpers
 */
import { describe, it, expect } from 'vitest';
import {
  analyzePromptRequirements,
  extractWorkflowArtifacts,
  buildWorkflowSummary,
  extractFinalAnswer
} from '../../src/core/workflow-helpers.js';

describe('Workflow Helpers', () => {
  describe('analyzePromptRequirements', () => {
    it('should detect repository-related prompts', () => {
      const prompt = 'Fix a bug in the repository';
      const result = analyzePromptRequirements(prompt);

      expect(result.mentionsRepository).toBe(true);
      expect(result.requiresCode).toBe(true);
      expect(result.requiresDataAnalysis).toBe(true);
    });

    it('should detect documentation-related prompts', () => {
      const prompt = 'Update the README documentation';
      const result = analyzePromptRequirements(prompt);

      expect(result.mentionsDocs).toBe(true);
      expect(result.requiresResearch).toBe(true);
      expect(result.requiresKnowledge).toBe(true);
      expect(result.requiresDataAnalysis).toBe(true);
    });

    it('should detect ReAct methodology prompts', () => {
      const prompt = 'Use ReAct plan/apply/test approach';
      const result = analyzePromptRequirements(prompt);

      expect(result.wantsReAct).toBe(true);
      expect(result.requiresResearch).toBe(true);
      expect(result.requiresArchitecture).toBe(true);
      expect(result.requiresKnowledge).toBe(true);
      expect(result.requiresDataAnalysis).toBe(true);
      expect(result.requiresCode).toBe(true);
      expect(result.requiresTesting).toBe(true);
    });

    it('should detect architecture-related prompts', () => {
      const prompt = 'Design the mesh topology architecture';
      const result = analyzePromptRequirements(prompt);

      expect(result.requiresArchitecture).toBe(true);
    });

    it('should detect code-related prompts', () => {
      const prompt = 'Implement a new service module';
      const result = analyzePromptRequirements(prompt);

      expect(result.requiresCode).toBe(true);
    });

    it('should detect testing-related prompts', () => {
      const prompt = 'Write validation tests for the feature';
      const result = analyzePromptRequirements(prompt);

      expect(result.requiresTesting).toBe(true);
    });

    it('should detect data analysis prompts', () => {
      const prompt = 'Analyze the metrics and evaluate performance';
      const result = analyzePromptRequirements(prompt);

      expect(result.requiresDataAnalysis).toBe(true);
    });

    it('should handle prompts with no special requirements', () => {
      const prompt = 'Hello world';
      const result = analyzePromptRequirements(prompt);

      expect(result.wantsReAct).toBe(false);
      expect(result.requiresCode).toBe(false);
      expect(result.requiresResearch).toBe(false);
    });
  });

  describe('extractWorkflowArtifacts', () => {
    it('should extract all workflow artifacts', () => {
      const stageResults = {
        'research-scan': { result: { summary: 'Research done' } },
        'react-plan': { result: { summary: 'Plan created' } },
        'architecture-blueprint': { result: { summary: 'Architecture designed' } },
        'code-generation': { result: { generatedCode: 'const x = 1;' } },
        'code-lint': { result: { issues: [] } },
        'validation': { result: { passed: true } },
        'insight-summary': { result: { summary: 'Insights gathered' } },
        'knowledge-distillation': { result: { summary: 'Knowledge extracted' } },
        'openai-synthesis': { result: { summary: 'Final synthesis' } }
      };

      const result = extractWorkflowArtifacts(stageResults);

      expect(result.research).toEqual({ summary: 'Research done' });
      expect(result.reactPlan).toEqual({ summary: 'Plan created' });
      expect(result.architecture).toEqual({ summary: 'Architecture designed' });
      expect(result.code).toBe('const x = 1;');
      expect(result.lintIssues).toEqual([]);
      expect(result.validation).toEqual({ passed: true });
      expect(result.insight).toEqual({ summary: 'Insights gathered' });
      expect(result.knowledge).toEqual({ summary: 'Knowledge extracted' });
      expect(result.openaiSynthesis).toEqual({ summary: 'Final synthesis' });
    });

    it('should return null for missing artifacts', () => {
      const stageResults = {};
      const result = extractWorkflowArtifacts(stageResults);

      expect(result.research).toBeNull();
      expect(result.reactPlan).toBeNull();
      expect(result.code).toBeNull();
      expect(result.lintIssues).toEqual([]);
    });
  });

  describe('buildWorkflowSummary', () => {
    it('should build summary from all artifacts', () => {
      const artifacts = {
        research: { summary: 'Research completed' },
        reactPlan: { summary: 'Plan ready' },
        architecture: { summary: 'Architecture done' },
        code: 'const x = 1;',
        lintIssues: [],
        validation: { passed: true },
        insight: { summary: 'Insights ready' },
        knowledge: { summary: 'Knowledge extracted' },
        openaiSynthesis: { summary: 'Synthesis complete' }
      };

      const result = buildWorkflowSummary(artifacts);

      expect(result).toContain('Research completed');
      expect(result).toContain('Plan ready');
      expect(result).toContain('Architecture done');
      expect(result).toContain('Generated implementation scaffold.');
      expect(result).toContain('Code lint checks passed.');
      expect(result).toContain('Validation gates satisfied.');
      expect(result).toContain('Insights ready');
      expect(result).toContain('Knowledge extracted');
      expect(result).toContain('Synthesis complete');
    });

    it('should return default message when no artifacts have summaries', () => {
      const artifacts = {
        research: null,
        reactPlan: null,
        architecture: null,
        code: null,
        lintIssues: [{ issue: 'some issue' }], // Has lint issues, so won't show "passed"
        validation: null,
        insight: null,
        knowledge: null,
        openaiSynthesis: null
      };

      const result = buildWorkflowSummary(artifacts);
      expect(result).toBe('Workflow executed with available agents.');
    });

    it('should only include available summaries', () => {
      const artifacts = {
        research: { summary: 'Research done' },
        reactPlan: null,
        architecture: null,
        code: null,
        lintIssues: [{ issue: 'warning' }],
        validation: null,
        insight: null,
        knowledge: null,
        openaiSynthesis: null
      };

      const result = buildWorkflowSummary(artifacts);
      expect(result).toContain('Research done');
      expect(result).not.toContain('Code lint checks passed.');
    });
  });

  describe('extractFinalAnswer', () => {
    it('should extract final answer from synthesis', () => {
      const openaiSynthesis = {
        finalAnswer: 'This is the final answer'
      };

      const result = extractFinalAnswer(openaiSynthesis);
      expect(result).toBe('This is the final answer');
    });

    it('should return undefined when no final answer', () => {
      const openaiSynthesis = {
        summary: 'Just a summary'
      };

      const result = extractFinalAnswer(openaiSynthesis);
      expect(result).toBeUndefined();
    });

    it('should return undefined when synthesis is null', () => {
      const result = extractFinalAnswer(null);
      expect(result).toBeUndefined();
    });

    it('should return undefined when finalAnswer is not a string', () => {
      const openaiSynthesis = {
        finalAnswer: { complex: 'object' }
      };

      const result = extractFinalAnswer(openaiSynthesis);
      expect(result).toBeUndefined();
    });
  });
});
