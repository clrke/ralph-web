import * as fs from 'fs';
import * as path from 'path';
import {
  PlanValidator,
  planValidator,
  PlanValidationResult,
  IncompleteSectionInfo,
} from './PlanValidator';
import type {
  ComposablePlan,
  PlanStep,
} from '@claude-code-web/shared';

/**
 * Result of checking plan completeness
 */
export interface PlanCompletenessResult {
  complete: boolean;
  missingContext: string;
  validationResult: PlanValidationResult;
}

/**
 * Detailed reprompt context for returning to Stage 2
 */
export interface RepromptContext {
  summary: string;
  incompleteSections: string[];
  stepsLackingComplexity: string[];
  unmappedAcceptanceCriteria: string[];
  insufficientDescriptions: string[];
  detailedContext: string;
}

/**
 * PlanCompletionChecker determines if a composable plan is complete enough
 * to proceed from Stage 2 to Stage 3.
 *
 * This service reads plan files from the session directory, runs validation,
 * and generates context for re-prompting Claude if the plan is incomplete.
 */
export class PlanCompletionChecker {
  private validator: PlanValidator;

  constructor(validator?: PlanValidator) {
    this.validator = validator || planValidator;
  }

  /**
   * Check if a plan is complete by reading plan.json from the session directory.
   * Returns completeness status and missing context for re-prompting.
   */
  async checkPlanCompleteness(sessionDir: string): Promise<PlanCompletenessResult> {
    // Try to read the plan from the session directory
    const plan = await this.readPlan(sessionDir);

    if (!plan) {
      return {
        complete: false,
        missingContext: 'No plan found in session directory. Please create a plan first.',
        validationResult: this.createEmptyValidationResult(),
      };
    }

    // Run validation
    const validationResult = this.validator.validatePlan(plan);

    // Generate missing context if incomplete
    const missingContext = validationResult.overall
      ? ''
      : this.validator.generateValidationContext(plan);

    return {
      complete: validationResult.overall,
      missingContext,
      validationResult,
    };
  }

  /**
   * Synchronous version of checkPlanCompleteness that takes a pre-loaded plan.
   * Useful when the plan is already in memory.
   */
  checkPlanCompletenessSync(plan: unknown): PlanCompletenessResult {
    if (!plan) {
      return {
        complete: false,
        missingContext: 'No plan provided. Please create a plan first.',
        validationResult: this.createEmptyValidationResult(),
      };
    }

    const validationResult = this.validator.validatePlan(plan);
    const missingContext = validationResult.overall
      ? ''
      : this.validator.generateValidationContext(plan);

    return {
      complete: validationResult.overall,
      missingContext,
      validationResult,
    };
  }

  /**
   * Determine if the validation result indicates we should return to Stage 2.
   * Returns true if the plan needs more work before proceeding to Stage 3.
   */
  shouldReturnToStage2(validationResult: PlanValidationResult): boolean {
    // If overall is false, we need to return to Stage 2
    if (!validationResult.overall) {
      return true;
    }

    // Additional checks that might require returning to Stage 2
    // even if basic validation passes

    // Check if steps section has any warnings (future extensibility)
    // For now, we rely on overall validation status
    return false;
  }

  /**
   * Build detailed reprompt context for Stage 2 re-entry.
   * This provides structured information about what's missing in the plan.
   */
  buildRepromptContext(validationResult: PlanValidationResult, plan?: unknown): RepromptContext {
    const incompleteSections: string[] = [];
    const stepsLackingComplexity: string[] = [];
    const unmappedAcceptanceCriteria: string[] = [];
    const insufficientDescriptions: string[] = [];

    // Identify incomplete sections
    if (!validationResult.meta.valid) {
      incompleteSections.push('meta');
    }
    if (!validationResult.steps.valid) {
      incompleteSections.push('steps');
    }
    if (!validationResult.dependencies.valid) {
      incompleteSections.push('dependencies');
    }
    if (!validationResult.testCoverage.valid) {
      incompleteSections.push('testCoverage');
    }
    if (!validationResult.acceptanceMapping.valid) {
      incompleteSections.push('acceptanceMapping');
    }

    // Extract specific issues from step errors
    for (const error of validationResult.steps.errors) {
      if (error.includes('complexity')) {
        // Extract step IDs lacking complexity
        const match = error.match(/Steps missing complexity rating: (.+)/);
        if (match) {
          stepsLackingComplexity.push(...match[1].split(', ').map(s => s.trim()));
        }
      }
      if (error.includes('description') && (error.includes('50 characters') || error.includes('too short'))) {
        // Extract step IDs with insufficient descriptions
        const stepMatch = error.match(/Step \d+ \(([^)]+)\)/);
        if (stepMatch) {
          insufficientDescriptions.push(stepMatch[1]);
        }
      }
    }

    // Extract unmapped acceptance criteria from acceptanceMapping errors
    for (const error of validationResult.acceptanceMapping.errors) {
      if (error.includes('no implementing steps') || error.includes('unmapped')) {
        const match = error.match(/Acceptance criteria "([^"]+)"/);
        if (match) {
          unmappedAcceptanceCriteria.push(match[1]);
        }
      }
    }

    // Build detailed context string
    const detailedContext = this.buildDetailedContextString(
      incompleteSections,
      stepsLackingComplexity,
      unmappedAcceptanceCriteria,
      insufficientDescriptions,
      validationResult
    );

    // Build summary
    const summary = this.buildSummary(
      incompleteSections,
      stepsLackingComplexity,
      unmappedAcceptanceCriteria,
      insufficientDescriptions
    );

    return {
      summary,
      incompleteSections,
      stepsLackingComplexity,
      unmappedAcceptanceCriteria,
      insufficientDescriptions,
      detailedContext,
    };
  }

  /**
   * Read plan from session directory.
   * Tries to read plan.json first, then falls back to constructing from plan/ directory.
   */
  private async readPlan(sessionDir: string): Promise<ComposablePlan | null> {
    // Try reading plan.json first
    const planJsonPath = path.join(sessionDir, 'plan.json');
    if (fs.existsSync(planJsonPath)) {
      try {
        const content = await fs.promises.readFile(planJsonPath, 'utf-8');
        const plan = JSON.parse(content);

        // Check if this is a composable plan structure
        if (this.isComposablePlan(plan)) {
          return plan as ComposablePlan;
        }

        // If it's an old format with steps array, convert it
        if (Array.isArray(plan.steps)) {
          return this.convertLegacyPlan(plan, sessionDir);
        }
      } catch {
        // Failed to read or parse plan.json
      }
    }

    // Try reading from composable plan directory structure
    return this.readComposablePlanFromDirectory(sessionDir);
  }

  /**
   * Check if an object looks like a composable plan.
   */
  private isComposablePlan(plan: unknown): boolean {
    if (!plan || typeof plan !== 'object') return false;
    const p = plan as Record<string, unknown>;
    return (
      'meta' in p &&
      'steps' in p &&
      'dependencies' in p &&
      'testCoverage' in p &&
      'acceptanceMapping' in p
    );
  }

  /**
   * Convert a legacy plan format to composable plan structure.
   */
  private convertLegacyPlan(legacyPlan: Record<string, unknown>, sessionDir: string): ComposablePlan {
    const steps = Array.isArray(legacyPlan.steps) ? legacyPlan.steps as PlanStep[] : [];

    return {
      meta: {
        version: '1.0.0',
        sessionId: (legacyPlan.sessionId as string) || path.basename(sessionDir),
        createdAt: (legacyPlan.createdAt as string) || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isApproved: (legacyPlan.isApproved as boolean) || false,
        reviewCount: (legacyPlan.reviewCount as number) || 0,
      },
      steps,
      dependencies: {
        stepDependencies: [],
        externalDependencies: [],
      },
      testCoverage: {
        framework: 'unknown',
        requiredTestTypes: [],
        stepCoverage: [],
      },
      acceptanceMapping: {
        mappings: [],
        updatedAt: new Date().toISOString(),
      },
      validationStatus: {
        meta: false,
        steps: false,
        dependencies: false,
        testCoverage: false,
        acceptanceMapping: false,
        overall: false,
      },
    };
  }

  /**
   * Read composable plan from directory structure.
   */
  private async readComposablePlanFromDirectory(sessionDir: string): Promise<ComposablePlan | null> {
    const planDir = path.join(sessionDir, 'plan');

    if (!fs.existsSync(planDir)) {
      return null;
    }

    try {
      // Read meta
      const metaPath = path.join(planDir, 'meta.json');
      const meta = fs.existsSync(metaPath)
        ? JSON.parse(await fs.promises.readFile(metaPath, 'utf-8'))
        : null;

      // Read steps from steps/ directory
      const stepsDir = path.join(planDir, 'steps');
      const steps: PlanStep[] = [];
      if (fs.existsSync(stepsDir)) {
        const stepFiles = await fs.promises.readdir(stepsDir);
        for (const file of stepFiles.sort()) {
          if (file.endsWith('.json')) {
            const stepContent = await fs.promises.readFile(path.join(stepsDir, file), 'utf-8');
            steps.push(JSON.parse(stepContent));
          }
        }
      }

      // Read dependencies
      const depsPath = path.join(planDir, 'dependencies.json');
      const dependencies = fs.existsSync(depsPath)
        ? JSON.parse(await fs.promises.readFile(depsPath, 'utf-8'))
        : { stepDependencies: [], externalDependencies: [] };

      // Read test coverage
      const testCoveragePath = path.join(planDir, 'test-coverage.json');
      const testCoverage = fs.existsSync(testCoveragePath)
        ? JSON.parse(await fs.promises.readFile(testCoveragePath, 'utf-8'))
        : { framework: 'unknown', requiredTypes: [], coverageTargets: {}, stepCoverage: [] };

      // Read acceptance mapping
      const acceptancePath = path.join(planDir, 'acceptance-mapping.json');
      const acceptanceMapping = fs.existsSync(acceptancePath)
        ? JSON.parse(await fs.promises.readFile(acceptancePath, 'utf-8'))
        : { criteria: [] };

      return {
        meta: meta || {
          version: '1.0.0',
          sessionId: path.basename(sessionDir),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          isApproved: false,
          reviewCount: 0,
        },
        steps,
        dependencies,
        testCoverage,
        acceptanceMapping,
        validationStatus: {
          meta: false,
          steps: false,
          dependencies: false,
          testCoverage: false,
          acceptanceMapping: false,
          overall: false,
        },
      };
    } catch {
      return null;
    }
  }

  /**
   * Create an empty validation result for when no plan is found.
   */
  private createEmptyValidationResult(): PlanValidationResult {
    return {
      meta: { valid: false, errors: ['No plan found'] },
      steps: { valid: false, errors: ['No plan found'] },
      dependencies: { valid: false, errors: ['No plan found'] },
      testCoverage: { valid: false, errors: ['No plan found'] },
      acceptanceMapping: { valid: false, errors: ['No plan found'] },
      overall: false,
    };
  }

  /**
   * Build a concise summary of what's missing.
   */
  private buildSummary(
    incompleteSections: string[],
    stepsLackingComplexity: string[],
    unmappedAcceptanceCriteria: string[],
    insufficientDescriptions: string[]
  ): string {
    const parts: string[] = [];

    if (incompleteSections.length > 0) {
      parts.push(`${incompleteSections.length} incomplete section(s): ${incompleteSections.join(', ')}`);
    }
    if (stepsLackingComplexity.length > 0) {
      parts.push(`${stepsLackingComplexity.length} step(s) missing complexity ratings`);
    }
    if (unmappedAcceptanceCriteria.length > 0) {
      parts.push(`${unmappedAcceptanceCriteria.length} unmapped acceptance criteria`);
    }
    if (insufficientDescriptions.length > 0) {
      parts.push(`${insufficientDescriptions.length} step(s) with insufficient descriptions`);
    }

    if (parts.length === 0) {
      return 'Plan validation passed';
    }

    return `Plan incomplete: ${parts.join('; ')}`;
  }

  /**
   * Build a detailed context string for the reprompt.
   */
  private buildDetailedContextString(
    incompleteSections: string[],
    stepsLackingComplexity: string[],
    unmappedAcceptanceCriteria: string[],
    insufficientDescriptions: string[],
    validationResult: PlanValidationResult
  ): string {
    const lines: string[] = [
      '## Plan Validation Failed',
      '',
      'The plan is not yet complete. Please address the following issues before the plan can be approved:',
      '',
    ];

    // Incomplete sections
    if (incompleteSections.length > 0) {
      lines.push('### Incomplete Sections');
      lines.push('');
      for (const section of incompleteSections) {
        const sectionResult = validationResult[section as keyof Omit<PlanValidationResult, 'overall'>];
        if (sectionResult && 'errors' in sectionResult) {
          lines.push(`#### ${this.formatSectionName(section)}`);
          for (const error of sectionResult.errors) {
            lines.push(`- ${error}`);
          }
          lines.push('');
        }
      }
    }

    // Steps lacking complexity
    if (stepsLackingComplexity.length > 0) {
      lines.push('### Steps Missing Complexity Ratings');
      lines.push('');
      lines.push('The following steps need a complexity rating (low, medium, or high):');
      lines.push('');
      for (const stepId of stepsLackingComplexity) {
        lines.push(`- ${stepId}`);
      }
      lines.push('');
    }

    // Unmapped acceptance criteria
    if (unmappedAcceptanceCriteria.length > 0) {
      lines.push('### Unmapped Acceptance Criteria');
      lines.push('');
      lines.push('The following acceptance criteria are not mapped to any implementing steps:');
      lines.push('');
      for (const criteria of unmappedAcceptanceCriteria) {
        lines.push(`- ${criteria}`);
      }
      lines.push('');
    }

    // Insufficient descriptions
    if (insufficientDescriptions.length > 0) {
      lines.push('### Steps With Insufficient Descriptions');
      lines.push('');
      lines.push('The following steps need more detailed descriptions (at least 50 characters):');
      lines.push('');
      for (const stepId of insufficientDescriptions) {
        lines.push(`- ${stepId}`);
      }
      lines.push('');
    }

    // Instructions
    lines.push('### Instructions');
    lines.push('');
    lines.push('Please update the plan to address these issues. Edit the appropriate new-*.json files:');
    lines.push('- `new-steps.json` for step updates');
    lines.push('- `new-dependencies.json` for dependency updates');
    lines.push('- `new-test-coverage.json` for test coverage updates');
    lines.push('- `new-acceptance.json` for acceptance criteria mapping updates');
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Format section name for display.
   */
  private formatSectionName(section: string): string {
    const names: Record<string, string> = {
      meta: 'Plan Metadata',
      steps: 'Plan Steps',
      dependencies: 'Dependencies',
      testCoverage: 'Test Coverage',
      acceptanceMapping: 'Acceptance Criteria Mapping',
    };
    return names[section] || section;
  }
}

// Export a singleton instance for convenience
export const planCompletionChecker = new PlanCompletionChecker();
