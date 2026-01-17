import type { AcceptanceCriterion } from '@claude-code-web/shared';
import {
  ChangeComplexity,
  CHANGE_COMPLEXITY_LEVELS,
  ComplexityAssessment,
} from '@claude-code-web/shared';
import { buildComplexityAssessmentPrompt } from '../../server/src/prompts/validationPrompts';

describe('ChangeComplexity type', () => {
  describe('CHANGE_COMPLEXITY_LEVELS', () => {
    it('should contain all four complexity levels', () => {
      expect(CHANGE_COMPLEXITY_LEVELS).toHaveLength(4);
      expect(CHANGE_COMPLEXITY_LEVELS).toContain('trivial');
      expect(CHANGE_COMPLEXITY_LEVELS).toContain('simple');
      expect(CHANGE_COMPLEXITY_LEVELS).toContain('normal');
      expect(CHANGE_COMPLEXITY_LEVELS).toContain('complex');
    });

    it('should be in order from least to most complex', () => {
      expect(CHANGE_COMPLEXITY_LEVELS[0]).toBe('trivial');
      expect(CHANGE_COMPLEXITY_LEVELS[1]).toBe('simple');
      expect(CHANGE_COMPLEXITY_LEVELS[2]).toBe('normal');
      expect(CHANGE_COMPLEXITY_LEVELS[3]).toBe('complex');
    });
  });

  describe('ChangeComplexity type inference', () => {
    it('should allow valid complexity values', () => {
      const trivial: ChangeComplexity = 'trivial';
      const simple: ChangeComplexity = 'simple';
      const normal: ChangeComplexity = 'normal';
      const complex: ChangeComplexity = 'complex';

      expect(trivial).toBe('trivial');
      expect(simple).toBe('simple');
      expect(normal).toBe('normal');
      expect(complex).toBe('complex');
    });

    it('should work with runtime validation using CHANGE_COMPLEXITY_LEVELS', () => {
      const validateComplexity = (value: string): value is ChangeComplexity => {
        return CHANGE_COMPLEXITY_LEVELS.includes(value as ChangeComplexity);
      };

      expect(validateComplexity('trivial')).toBe(true);
      expect(validateComplexity('simple')).toBe(true);
      expect(validateComplexity('normal')).toBe(true);
      expect(validateComplexity('complex')).toBe(true);
      expect(validateComplexity('invalid')).toBe(false);
      expect(validateComplexity('')).toBe(false);
    });
  });

  describe('ComplexityAssessment interface', () => {
    it('should allow creating a valid assessment object', () => {
      const assessment: ComplexityAssessment = {
        complexity: 'simple',
        reason: 'Frontend label change only',
        suggestedAgents: ['frontend'],
        useLeanPrompts: true,
        durationMs: 1500,
        prompt: 'Test prompt',
        output: '{"complexity": "simple"}',
      };

      expect(assessment.complexity).toBe('simple');
      expect(assessment.reason).toBe('Frontend label change only');
      expect(assessment.suggestedAgents).toEqual(['frontend']);
      expect(assessment.useLeanPrompts).toBe(true);
      expect(assessment.durationMs).toBe(1500);
    });

    it('should allow multiple suggested agents', () => {
      const assessment: ComplexityAssessment = {
        complexity: 'normal',
        reason: 'API endpoint with database changes',
        suggestedAgents: ['backend', 'database', 'testing'],
        useLeanPrompts: false,
        durationMs: 2000,
        prompt: 'Test prompt',
        output: '{}',
      };

      expect(assessment.suggestedAgents).toHaveLength(3);
      expect(assessment.suggestedAgents).toContain('backend');
      expect(assessment.suggestedAgents).toContain('database');
      expect(assessment.suggestedAgents).toContain('testing');
    });
  });
});

describe('buildComplexityAssessmentPrompt', () => {
  describe('basic functionality', () => {
    it('should include the feature title in the prompt', () => {
      const prompt = buildComplexityAssessmentPrompt(
        'Change button label',
        'Update the submit button text from "Submit" to "Save"',
        []
      );

      expect(prompt).toContain('Change button label');
    });

    it('should include the feature description in the prompt', () => {
      const prompt = buildComplexityAssessmentPrompt(
        'Change button label',
        'Update the submit button text from "Submit" to "Save"',
        []
      );

      expect(prompt).toContain('Update the submit button text from "Submit" to "Save"');
    });

    it('should format acceptance criteria with numbered list', () => {
      const criteria: AcceptanceCriterion[] = [
        { text: 'Button shows "Save" text', checked: false, type: 'manual' },
        { text: 'Button styling unchanged', checked: false, type: 'manual' },
      ];

      const prompt = buildComplexityAssessmentPrompt(
        'Change button label',
        'Update button text',
        criteria
      );

      expect(prompt).toContain('1. Button shows "Save" text');
      expect(prompt).toContain('2. Button styling unchanged');
    });

    it('should handle empty acceptance criteria', () => {
      const prompt = buildComplexityAssessmentPrompt(
        'Simple change',
        'A simple description',
        []
      );

      expect(prompt).toContain('No acceptance criteria specified.');
    });
  });

  describe('complexity level definitions', () => {
    it('should include trivial complexity definition', () => {
      const prompt = buildComplexityAssessmentPrompt('Title', 'Description', []);

      expect(prompt).toContain('**trivial**');
      expect(prompt).toContain('Single-line changes');
      expect(prompt).toContain('typo fixes');
      expect(prompt).toContain('config value tweaks');
    });

    it('should include simple complexity definition', () => {
      const prompt = buildComplexityAssessmentPrompt('Title', 'Description', []);

      expect(prompt).toContain('**simple**');
      expect(prompt).toContain('Localized changes');
      expect(prompt).toContain('Change a button label');
    });

    it('should include normal complexity definition', () => {
      const prompt = buildComplexityAssessmentPrompt('Title', 'Description', []);

      expect(prompt).toContain('**normal**');
      expect(prompt).toContain('Standard features');
      expect(prompt).toContain('Add a new API endpoint');
    });

    it('should include complex complexity definition', () => {
      const prompt = buildComplexityAssessmentPrompt('Title', 'Description', []);

      expect(prompt).toContain('**complex**');
      expect(prompt).toContain('Large features');
      expect(prompt).toContain('architectural changes');
    });
  });

  describe('agent types', () => {
    it('should list all available agent types', () => {
      const prompt = buildComplexityAssessmentPrompt('Title', 'Description', []);

      expect(prompt).toContain('"frontend"');
      expect(prompt).toContain('"backend"');
      expect(prompt).toContain('"database"');
      expect(prompt).toContain('"testing"');
      expect(prompt).toContain('"infrastructure"');
      expect(prompt).toContain('"documentation"');
    });

    it('should describe what each agent type handles', () => {
      const prompt = buildComplexityAssessmentPrompt('Title', 'Description', []);

      expect(prompt).toContain('UI components');
      expect(prompt).toContain('API endpoints');
      expect(prompt).toContain('Schema changes');
      expect(prompt).toContain('Test files');
      expect(prompt).toContain('CI/CD');
      expect(prompt).toContain('README');
    });
  });

  describe('response format', () => {
    it('should specify JSON-only response format', () => {
      const prompt = buildComplexityAssessmentPrompt('Title', 'Description', []);

      expect(prompt).toContain('## Response Format (JSON only)');
    });

    it('should include all required response fields', () => {
      const prompt = buildComplexityAssessmentPrompt('Title', 'Description', []);

      expect(prompt).toContain('"complexity"');
      expect(prompt).toContain('"reason"');
      expect(prompt).toContain('"suggestedAgents"');
      expect(prompt).toContain('"useLeanPrompts"');
    });

    it('should specify valid complexity values in response format', () => {
      const prompt = buildComplexityAssessmentPrompt('Title', 'Description', []);

      expect(prompt).toContain('"trivial" | "simple" | "normal" | "complex"');
    });
  });

  describe('rules', () => {
    it('should include conservative complexity rule', () => {
      const prompt = buildComplexityAssessmentPrompt('Title', 'Description', []);

      expect(prompt).toContain('Err on the side of higher complexity if unsure');
    });

    it('should include agent count guidance per complexity level', () => {
      const prompt = buildComplexityAssessmentPrompt('Title', 'Description', []);

      expect(prompt).toContain('For trivial/simple: suggest only 1-2 most relevant agents');
      expect(prompt).toContain('For normal: suggest 3-4 agents');
      expect(prompt).toContain('For complex: suggest all 6 agents');
    });

    it('should include lean prompts guidance', () => {
      const prompt = buildComplexityAssessmentPrompt('Title', 'Description', []);

      expect(prompt).toContain('useLeanPrompts should be true for trivial/simple');
      expect(prompt).toContain('false for normal/complex');
    });
  });

  describe('edge cases', () => {
    it('should handle very long title', () => {
      const longTitle = 'A'.repeat(500);
      const prompt = buildComplexityAssessmentPrompt(longTitle, 'Description', []);

      expect(prompt).toContain(longTitle);
    });

    it('should handle very long description', () => {
      const longDescription = 'B'.repeat(1000);
      const prompt = buildComplexityAssessmentPrompt('Title', longDescription, []);

      expect(prompt).toContain(longDescription);
    });

    it('should handle many acceptance criteria', () => {
      const criteria: AcceptanceCriterion[] = Array.from({ length: 20 }, (_, i) => ({
        text: `Criterion ${i + 1}`,
        checked: false,
        type: 'manual' as const,
      }));

      const prompt = buildComplexityAssessmentPrompt('Title', 'Description', criteria);

      expect(prompt).toContain('1. Criterion 1');
      expect(prompt).toContain('20. Criterion 20');
    });

    it('should handle special characters in inputs', () => {
      const prompt = buildComplexityAssessmentPrompt(
        'Title with "quotes" and <brackets>',
        'Description with `backticks` and $special chars',
        [{ text: 'Criterion with {braces} and [brackets]', checked: false, type: 'manual' }]
      );

      expect(prompt).toContain('Title with "quotes" and <brackets>');
      expect(prompt).toContain('Description with `backticks` and $special chars');
      expect(prompt).toContain('Criterion with {braces} and [brackets]');
    });

    it('should handle newlines in description', () => {
      const description = 'Line 1\nLine 2\nLine 3';
      const prompt = buildComplexityAssessmentPrompt('Title', description, []);

      expect(prompt).toContain('Line 1\nLine 2\nLine 3');
    });
  });
});
