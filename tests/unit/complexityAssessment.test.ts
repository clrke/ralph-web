import type { AcceptanceCriterion, Session, ComplexityAssessedEvent } from '@claude-code-web/shared';
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

describe('Session complexity fields', () => {
  const createBaseSession = (): Omit<Session, 'assessedComplexity' | 'complexityReason' | 'suggestedAgents' | 'complexityAssessedAt'> => ({
    version: '1.0',
    dataVersion: 1,
    id: 'session-123',
    projectId: 'project-abc',
    featureId: 'add-auth',
    title: 'Add Authentication',
    featureDescription: 'Add JWT auth',
    projectPath: '/test/project',
    acceptanceCriteria: [],
    affectedFiles: [],
    technicalNotes: '',
    baseBranch: 'main',
    featureBranch: 'feature/add-auth',
    baseCommitSha: 'abc123',
    status: 'queued',
    currentStage: 0,
    replanningCount: 0,
    claudeSessionId: null,
    claudePlanFilePath: null,
    currentPlanVersion: 0,
    claudeStage3SessionId: null,
    prUrl: null,
    sessionExpiresAt: '2026-01-12T00:00:00Z',
    createdAt: '2026-01-11T00:00:00Z',
    updatedAt: '2026-01-11T00:00:00Z',
  });

  it('should allow Session without complexity fields (backward compatible)', () => {
    const session: Session = createBaseSession();

    expect(session.assessedComplexity).toBeUndefined();
    expect(session.complexityReason).toBeUndefined();
    expect(session.suggestedAgents).toBeUndefined();
    expect(session.complexityAssessedAt).toBeUndefined();
  });

  it('should allow Session with all complexity fields populated', () => {
    const session: Session = {
      ...createBaseSession(),
      assessedComplexity: 'simple',
      complexityReason: 'Frontend label change only',
      suggestedAgents: ['frontend'],
      complexityAssessedAt: '2026-01-11T00:30:00Z',
    };

    expect(session.assessedComplexity).toBe('simple');
    expect(session.complexityReason).toBe('Frontend label change only');
    expect(session.suggestedAgents).toEqual(['frontend']);
    expect(session.complexityAssessedAt).toBe('2026-01-11T00:30:00Z');
  });

  it('should allow Session with partial complexity fields', () => {
    const session: Session = {
      ...createBaseSession(),
      assessedComplexity: 'normal',
      // Other fields left undefined
    };

    expect(session.assessedComplexity).toBe('normal');
    expect(session.complexityReason).toBeUndefined();
  });

  it('should allow all ChangeComplexity values in Session', () => {
    for (const complexity of CHANGE_COMPLEXITY_LEVELS) {
      const session: Session = {
        ...createBaseSession(),
        assessedComplexity: complexity,
      };
      expect(session.assessedComplexity).toBe(complexity);
    }
  });

  it('should allow multiple agents in suggestedAgents', () => {
    const session: Session = {
      ...createBaseSession(),
      assessedComplexity: 'complex',
      suggestedAgents: ['frontend', 'backend', 'database', 'testing', 'infrastructure', 'documentation'],
    };

    expect(session.suggestedAgents).toHaveLength(6);
  });
});

describe('ComplexityAssessedEvent', () => {
  it('should allow creating a valid ComplexityAssessedEvent', () => {
    const event: ComplexityAssessedEvent = {
      projectId: 'project-abc',
      featureId: 'add-auth',
      sessionId: 'session-123',
      complexity: 'simple',
      reason: 'Frontend label change only',
      suggestedAgents: ['frontend'],
      useLeanPrompts: true,
      durationMs: 1500,
      timestamp: '2026-01-11T00:30:00Z',
    };

    expect(event.projectId).toBe('project-abc');
    expect(event.featureId).toBe('add-auth');
    expect(event.sessionId).toBe('session-123');
    expect(event.complexity).toBe('simple');
    expect(event.reason).toBe('Frontend label change only');
    expect(event.suggestedAgents).toEqual(['frontend']);
    expect(event.useLeanPrompts).toBe(true);
    expect(event.durationMs).toBe(1500);
    expect(event.timestamp).toBe('2026-01-11T00:30:00Z');
  });

  it('should include projectId for cross-session validation (step-16 fix)', () => {
    // This test verifies the event structure supports projectId validation
    // The SessionView handler should check: if (data.projectId !== projectId) return;
    const currentProjectId = 'project-current';
    const otherProjectId = 'project-other';

    const eventForCurrentProject: ComplexityAssessedEvent = {
      projectId: currentProjectId,
      featureId: 'feature-123',
      sessionId: 'session-123',
      complexity: 'simple',
      reason: 'Simple change',
      suggestedAgents: ['frontend'],
      useLeanPrompts: true,
      durationMs: 1000,
      timestamp: new Date().toISOString(),
    };

    const eventForOtherProject: ComplexityAssessedEvent = {
      projectId: otherProjectId,
      featureId: 'feature-456',
      sessionId: 'session-456',
      complexity: 'complex',
      reason: 'Complex change',
      suggestedAgents: ['frontend', 'backend'],
      useLeanPrompts: false,
      durationMs: 2000,
      timestamp: new Date().toISOString(),
    };

    // Simulate the validation logic used in SessionView
    const shouldProcessEvent = (event: ComplexityAssessedEvent, sessionProjectId: string): boolean => {
      return event.projectId === sessionProjectId;
    };

    // Event for current project should be processed
    expect(shouldProcessEvent(eventForCurrentProject, currentProjectId)).toBe(true);

    // Event for other project should be ignored (prevents cross-session pollution)
    expect(shouldProcessEvent(eventForOtherProject, currentProjectId)).toBe(false);
  });

  it('should include useLeanPrompts for session store update (step-18 fix)', () => {
    // This test verifies the event includes useLeanPrompts which should be
    // applied to session.useLeanPrompts by applyComplexityAssessment
    const eventWithLeanPrompts: ComplexityAssessedEvent = {
      projectId: 'project-abc',
      featureId: 'feature-123',
      sessionId: 'session-123',
      complexity: 'simple',
      reason: 'Simple change',
      suggestedAgents: ['frontend'],
      useLeanPrompts: true,
      durationMs: 1000,
      timestamp: new Date().toISOString(),
    };

    const eventWithoutLeanPrompts: ComplexityAssessedEvent = {
      projectId: 'project-abc',
      featureId: 'feature-456',
      sessionId: 'session-456',
      complexity: 'complex',
      reason: 'Complex change',
      suggestedAgents: ['frontend', 'backend', 'database', 'testing'],
      useLeanPrompts: false,
      durationMs: 2000,
      timestamp: new Date().toISOString(),
    };

    // Verify useLeanPrompts is properly included in event data
    expect(eventWithLeanPrompts.useLeanPrompts).toBe(true);
    expect(eventWithoutLeanPrompts.useLeanPrompts).toBe(false);

    // Simulate what applyComplexityAssessment does
    const applyToSession = (event: ComplexityAssessedEvent) => ({
      assessedComplexity: event.complexity,
      complexityReason: event.reason,
      suggestedAgents: event.suggestedAgents,
      useLeanPrompts: event.useLeanPrompts,
      complexityAssessedAt: event.timestamp,
    });

    const sessionAfterSimple = applyToSession(eventWithLeanPrompts);
    expect(sessionAfterSimple.useLeanPrompts).toBe(true);

    const sessionAfterComplex = applyToSession(eventWithoutLeanPrompts);
    expect(sessionAfterComplex.useLeanPrompts).toBe(false);
  });

  it('should allow all complexity levels', () => {
    for (const complexity of CHANGE_COMPLEXITY_LEVELS) {
      const event: ComplexityAssessedEvent = {
        projectId: 'project-abc',
        featureId: 'feature-123',
        sessionId: 'session-123',
        complexity,
        reason: `Complexity is ${complexity}`,
        suggestedAgents: [],
        useLeanPrompts: complexity === 'trivial' || complexity === 'simple',
        durationMs: 1000,
        timestamp: new Date().toISOString(),
      };
      expect(event.complexity).toBe(complexity);
    }
  });

  it('should allow empty suggestedAgents array', () => {
    const event: ComplexityAssessedEvent = {
      projectId: 'project-abc',
      featureId: 'feature-123',
      sessionId: 'session-123',
      complexity: 'normal',
      reason: 'Normal change',
      suggestedAgents: [],
      useLeanPrompts: false,
      durationMs: 2000,
      timestamp: new Date().toISOString(),
    };

    expect(event.suggestedAgents).toEqual([]);
  });

  it('should allow all six agent types', () => {
    const event: ComplexityAssessedEvent = {
      projectId: 'project-abc',
      featureId: 'feature-123',
      sessionId: 'session-123',
      complexity: 'complex',
      reason: 'Complex change requiring all agents',
      suggestedAgents: ['frontend', 'backend', 'database', 'testing', 'infrastructure', 'documentation'],
      useLeanPrompts: false,
      durationMs: 3000,
      timestamp: new Date().toISOString(),
    };

    expect(event.suggestedAgents).toHaveLength(6);
  });
});
