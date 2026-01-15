import type {
  StepComplexity,
  PlanMeta,
  PlanDependencies,
  StepDependency,
  ExternalDependency,
  PlanTestCoverage,
  StepTestCoverage,
  PlanAcceptanceCriteriaMapping,
  AcceptanceCriteriaStepMapping,
  ComposablePlan,
  PlanStep,
} from '@claude-code-web/shared';

export interface DecisionOption {
  label: string;
  recommended: boolean;
  description?: string;
}

export interface ParsedDecision {
  priority: number;
  category: string;
  questionText: string;
  options: DecisionOption[];
  file?: string;
  line?: number;
}

export interface ParsedPlanStep {
  id: string;
  parentId: string | null;
  status: string;
  title: string;
  description: string;
  /** Complexity rating extracted from marker attributes */
  complexity?: StepComplexity;
  /** Acceptance criteria IDs this step addresses */
  acceptanceCriteriaIds?: string[];
  /** Estimated files to be modified */
  estimatedFiles?: string[];
}

export interface ParsedStepComplete {
  id: string;
  summary: string;
  testsAdded: string[];
  testsPassing: boolean;
}

export interface ParsedImplementationStatus {
  stepId: string;
  status: string;
  filesModified: number;
  testsStatus: string;
  workType: string;
  progress: number;
  message: string;
}

export interface ParsedPRCreated {
  title: string;
  sourceBranch: string;
  targetBranch: string;
  url?: string;
}

export interface ParsedCIStatus {
  status: 'passing' | 'failing' | 'pending';
  checks: string;
}

export interface ParsedReturnToStage2 {
  reason: string;
}

export interface ParsedMarker {
  decisions: ParsedDecision[];
  planSteps: ParsedPlanStep[];
  stepCompleted: ParsedStepComplete | null;
  stepsCompleted: ParsedStepComplete[];
  /** @deprecated Not used for business logic. Will be removed in future version. */
  planModeEntered: boolean;
  /** @deprecated Not used for business logic. Will be removed in future version. */
  planModeExited: boolean;
  planFilePath: string | null;
  implementationComplete: boolean;
  implementationSummary: string | null;
  implementationStatus: ParsedImplementationStatus | null;
  allTestsPassing: boolean;
  testsAdded: string[];
  prCreated: ParsedPRCreated | null;
  planApproved: boolean;
  // Stage 5: PR Review markers
  ciStatus: ParsedCIStatus | null;
  ciFailed: boolean;
  prApproved: boolean;
  returnToStage2: ParsedReturnToStage2 | null;
}

export class OutputParser {
  parse(input: string): ParsedMarker {
    const stepsCompleted = this.parseAllStepsComplete(input);
    const implementationInfo = this.parseImplementationComplete(input);
    return {
      decisions: this.parseDecisions(input),
      planSteps: this.parsePlanSteps(input),
      stepCompleted: stepsCompleted.length > 0 ? stepsCompleted[stepsCompleted.length - 1] : null,
      stepsCompleted,
      planModeEntered: input.includes('[PLAN_MODE_ENTERED]'),
      planModeExited: input.includes('[PLAN_MODE_EXITED]'),
      planFilePath: this.parsePlanFile(input),
      implementationComplete: input.includes('[IMPLEMENTATION_COMPLETE]'),
      implementationSummary: implementationInfo.summary,
      implementationStatus: this.parseImplementationStatus(input),
      allTestsPassing: implementationInfo.allTestsPassing,
      testsAdded: implementationInfo.testsAdded,
      prCreated: this.parsePRCreated(input),
      planApproved: /^\[PLAN_APPROVED\]$/m.test(input),
      // Stage 5: PR Review markers
      ciStatus: this.parseCIStatus(input),
      ciFailed: input.includes('[CI_FAILED]'),
      prApproved: input.includes('[PR_APPROVED]'),
      returnToStage2: this.parseReturnToStage2(input),
    };
  }

  private parseDecisions(input: string): ParsedDecision[] {
    const decisions: ParsedDecision[] = [];
    const regex = /\[DECISION_NEEDED([^\]]*)\]([\s\S]*?)\[\/DECISION_NEEDED\]/g;

    let match;
    while ((match = regex.exec(input)) !== null) {
      const attrs = this.parseAttributes(match[1]);
      const content = match[2].trim();

      const lines = content.split('\n');
      const questionLines: string[] = [];
      const options: DecisionOption[] = [];

      // First pass: identify where options start (look for "Option X:" pattern)
      let optionsStartIndex = -1;
      for (let i = 0; i < lines.length; i++) {
        if (/^-\s+\*?\*?Option\s+\w+/i.test(lines[i])) {
          optionsStartIndex = i;
          break;
        }
      }

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Only treat as option if:
        // 1. We're in the options section (after "Option X:" was found), OR
        // 2. Line explicitly has "Option X:" prefix, OR
        // 3. Line has "(recommended)" suffix
        const isInOptionsSection = optionsStartIndex >= 0 && i >= optionsStartIndex;
        const hasOptionPrefix = /^-\s+\*?\*?Option\s+\w+/i.test(line);
        const hasRecommendedSuffix = line.toLowerCase().includes('(recommended)');

        if ((isInOptionsSection || hasOptionPrefix || hasRecommendedSuffix) && line.trim().startsWith('-')) {
          const optionMatch = line.match(/^-\s+(?:\*?\*?Option\s+\w+:\s*\*?\*?\s*)?(.+?)(?:\s+\(recommended\))?$/i);
          if (optionMatch) {
            const isRecommended = hasRecommendedSuffix;
            // Strip markdown bold markers (**) from label - they shouldn't be in option text
            const label = optionMatch[1]
              .replace(/\s*\(recommended\)\s*/i, '')
              .replace(/^\*\*|\*\*$/g, '') // Strip leading/trailing **
              .trim();
            options.push({ label, recommended: isRecommended });
          }
        } else if (line.trim()) {
          questionLines.push(line);
        }
      }

      // Only add decisions that have at least one option
      if (options.length === 0) {
        continue;
      }

      // If no option is marked as recommended, mark the first one
      if (!options.some(o => o.recommended)) {
        options[0].recommended = true;
      }

      decisions.push({
        priority: this.safeParseInt(attrs.priority, 3),
        category: attrs.category || 'general',
        questionText: questionLines.join('\n').trim(),
        options,
        file: attrs.file,
        line: attrs.line ? this.safeParseInt(attrs.line, undefined) : undefined,
      });
    }

    return decisions;
  }

  parsePlanSteps(input: string): ParsedPlanStep[] {
    const steps: ParsedPlanStep[] = [];
    const regex = /\[PLAN_STEP([^\]]*)\]([\s\S]*?)\[\/PLAN_STEP\]/g;

    let match;
    while ((match = regex.exec(input)) !== null) {
      const attrs = this.parseAttributes(match[1]);
      const content = match[2].trim();
      const lines = content.split('\n');

      // Parse complexity from attributes
      const complexity = this.parseComplexity(attrs.complexity);

      // Parse acceptance criteria IDs (comma-separated)
      const acceptanceCriteriaIds = attrs.acceptanceCriteria
        ? attrs.acceptanceCriteria.split(',').map(s => s.trim()).filter(Boolean)
        : undefined;

      // Parse estimated files (comma-separated)
      const estimatedFiles = attrs.estimatedFiles
        ? attrs.estimatedFiles.split(',').map(s => s.trim()).filter(Boolean)
        : undefined;

      steps.push({
        id: attrs.id || '',
        parentId: attrs.parent === 'null' ? null : (attrs.parent || null),
        status: attrs.status || 'pending',
        title: lines[0] || '',
        description: lines.slice(1).join('\n').trim(),
        complexity,
        acceptanceCriteriaIds,
        estimatedFiles,
      });
    }

    return steps;
  }

  /**
   * Parse complexity rating from attribute value.
   */
  private parseComplexity(value: string | undefined): StepComplexity | undefined {
    if (!value) return undefined;
    const normalized = value.toLowerCase().trim();
    if (normalized === 'low' || normalized === 'medium' || normalized === 'high') {
      return normalized;
    }
    return undefined;
  }

  private parseAllStepsComplete(input: string): ParsedStepComplete[] {
    const steps: ParsedStepComplete[] = [];
    const seenIds = new Set<string>();

    // Primary: Parse formal [STEP_COMPLETE] markers with closing tag (both quote styles)
    const formalRegex = /\[STEP_COMPLETE\s+id=['"]([^'"]+)['"]\]([\s\S]*?)\[\/STEP_COMPLETE\]/g;
    let match;
    while ((match = formalRegex.exec(input)) !== null) {
      const content = match[2].trim();

      // Parse tests added (e.g., "Tests added: file1.spec.ts, file2.spec.ts")
      const testsMatch = content.match(/Tests added:\s*(.+)/i);
      const testsAdded = testsMatch
        ? testsMatch[1].split(',').map(t => t.trim()).filter(t => t && t.toLowerCase() !== 'none')
        : [];

      // Parse tests passing status
      const passingMatch = content.match(/Tests passing:\s*(yes|no|true|false)/i);
      const testsPassing = passingMatch
        ? ['yes', 'true'].includes(passingMatch[1].toLowerCase())
        : true; // Assume passing if not specified

      seenIds.add(match[1]);
      steps.push({
        id: match[1],
        summary: content,
        testsAdded,
        testsPassing,
      });
    }

    // Also parse self-closing [STEP_COMPLETE id="xxx"] without closing tag
    // Claude sometimes outputs just the marker without closing tag
    const selfClosingRegex = /\[STEP_COMPLETE\s+id=['"]([^'"]+)['"]\](?!\s*[\s\S]*?\[\/STEP_COMPLETE\])/g;
    while ((match = selfClosingRegex.exec(input)) !== null) {
      const stepId = match[1];
      if (seenIds.has(stepId)) continue; // Already found with closing tag

      // Try to extract summary from text after the marker
      const startPos = match.index + match[0].length;
      const remainingText = input.slice(startPos);
      // Get text until next marker, heading, or double newline
      const summaryMatch = remainingText.match(/^[\s\S]*?(?=\n\n|\[STEP_|\[IMPLEMENTATION|$)/);
      const summary = summaryMatch ? summaryMatch[0].trim() : `Step ${stepId} completed`;

      seenIds.add(stepId);
      steps.push({
        id: stepId,
        summary: summary || `Step ${stepId} completed`,
        testsAdded: [],
        testsPassing: true,
      });
    }

    // Fallback: Detect plain text patterns like "Step X Complete" or "**Step X Complete**"
    // This handles cases where Claude doesn't use the formal marker format
    const plainTextPatterns = [
      /(?:^|\n)#+\s*\*?\*?Step\s+(\d+|[a-z]+-\d+)\s+(?:Complete|Completed|Done)\*?\*?\s*(?:\n|$)/gi,
      /(?:^|\n)\*?\*?Step\s+(\d+|[a-z]+-\d+)\s+(?:Complete|Completed|Done)\*?\*?\s*(?:\n|$)/gi,
    ];

    for (const pattern of plainTextPatterns) {
      let plainMatch;
      while ((plainMatch = pattern.exec(input)) !== null) {
        const stepId = plainMatch[1];
        // Don't duplicate if already found via formal marker
        if (!seenIds.has(stepId)) {
          seenIds.add(stepId);
          // Try to extract summary from surrounding context (next ~500 chars)
          const startPos = plainMatch.index + plainMatch[0].length;
          const contextEnd = Math.min(startPos + 500, input.length);
          const context = input.slice(startPos, contextEnd).split(/\n(?:#+\s|\*\*Step|\[STEP)/)[0].trim();

          steps.push({
            id: stepId,
            summary: context || `Step ${stepId} completed`,
            testsAdded: [],
            testsPassing: true, // Assume passing if using informal completion
          });
        }
      }
    }

    return steps;
  }

  private parsePlanFile(input: string): string | null {
    const regex = /\[PLAN_FILE\s+path="([^"]+)"\]/;
    const match = input.match(regex);
    return match ? match[1] : null;
  }

  private parseImplementationComplete(input: string): { summary: string | null; allTestsPassing: boolean; testsAdded: string[] } {
    const regex = /\[IMPLEMENTATION_COMPLETE\]([\s\S]*?)\[\/IMPLEMENTATION_COMPLETE\]/;
    const match = input.match(regex);

    if (!match) {
      return { summary: null, allTestsPassing: false, testsAdded: [] };
    }

    const content = match[1].trim();

    // Parse "All tests passing: Yes/No"
    const passingMatch = content.match(/All tests passing:\s*(yes|no|true|false)/i);
    const allTestsPassing = passingMatch
      ? ['yes', 'true'].includes(passingMatch[1].toLowerCase())
      : false;

    // Parse "Tests added: file1.spec.ts, file2.spec.ts"
    const testsMatch = content.match(/Tests added:\s*(.+)/i);
    const testsAdded = testsMatch
      ? testsMatch[1].split(',').map(t => t.trim()).filter(t => t && t.toLowerCase() !== 'none')
      : [];

    return { summary: content, allTestsPassing, testsAdded };
  }

  private parseImplementationStatus(input: string): ParsedImplementationStatus | null {
    const regex = /\[IMPLEMENTATION_STATUS\]([\s\S]*?)\[\/IMPLEMENTATION_STATUS\]/;
    const match = input.match(regex);

    if (!match) return null;

    const content = match[1];
    const getValue = (key: string): string => {
      const lineMatch = content.match(new RegExp(`${key}:\\s*(.+)`, 'i'));
      return lineMatch ? lineMatch[1].trim() : '';
    };

    return {
      stepId: getValue('step_id'),
      status: getValue('status'),
      filesModified: this.safeParseInt(getValue('files_modified'), 0),
      testsStatus: getValue('tests_status'),
      workType: getValue('work_type'),
      progress: this.safeParseInt(getValue('progress'), 0),
      message: getValue('message'),
    };
  }

  private parsePRCreated(input: string): ParsedPRCreated | null {
    const regex = /\[PR_CREATED\]([\s\S]*?)\[\/PR_CREATED\]/;
    const match = input.match(regex);

    if (!match) return null;

    const content = match[1];
    const titleMatch = content.match(/Title:\s*(.+)/);
    const branchMatch = content.match(/Branch:\s*(\S+)\s*→\s*(\S+)/);
    const urlMatch = content.match(/URL:\s*(\S+)/);

    return {
      title: titleMatch ? titleMatch[1].trim() : '',
      sourceBranch: branchMatch ? branchMatch[1] : '',
      targetBranch: branchMatch ? branchMatch[2] : '',
      url: urlMatch ? urlMatch[1].trim() : undefined,
    };
  }

  private parseAttributes(attrString: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    const regex = /(\w+)="([^"]*)"/g;

    let match;
    while ((match = regex.exec(attrString)) !== null) {
      attrs[match[1]] = match[2];
    }

    return attrs;
  }

  private safeParseInt(value: string | undefined, defaultValue: number): number;
  private safeParseInt(value: string | undefined, defaultValue: undefined): number | undefined;
  private safeParseInt(value: string | undefined, defaultValue: number | undefined): number | undefined {
    if (!value) return defaultValue;
    const parsed = parseInt(value, 10);
    return Number.isNaN(parsed) ? defaultValue : parsed;
  }

  private parseCIStatus(input: string): ParsedCIStatus | null {
    const regex = /\[CI_STATUS\s+status="(passing|failing|pending)"\]([\s\S]*?)\[\/CI_STATUS\]/;
    const match = input.match(regex);

    if (!match) return null;

    return {
      status: match[1] as 'passing' | 'failing' | 'pending',
      checks: match[2].trim(),
    };
  }

  private parseReturnToStage2(input: string): ParsedReturnToStage2 | null {
    const regex = /\[RETURN_TO_STAGE_2\]([\s\S]*?)\[\/RETURN_TO_STAGE_2\]/;
    const match = input.match(regex);

    if (!match) return null;

    const content = match[1].trim();
    const reasonMatch = content.match(/Reason:\s*(.+)/i);

    return {
      reason: reasonMatch ? reasonMatch[1].trim() : content,
    };
  }

  // =========================================================================
  // Composable Plan Parsing Methods
  // =========================================================================

  /**
   * Parse [PLAN_META] marker to extract plan metadata.
   */
  parsePlanMeta(input: string): PlanMeta | null {
    const regex = /\[PLAN_META\]([\s\S]*?)\[\/PLAN_META\]/;
    const match = input.match(regex);

    if (!match) return null;

    const content = match[1].trim();
    const getValue = (key: string): string => {
      const lineMatch = content.match(new RegExp(`${key}:\\s*(.+)`, 'i'));
      return lineMatch ? lineMatch[1].trim() : '';
    };

    const now = new Date().toISOString();

    return {
      version: getValue('version') || '1.0.0',
      sessionId: getValue('sessionId') || getValue('session_id') || '',
      createdAt: getValue('createdAt') || getValue('created_at') || now,
      updatedAt: getValue('updatedAt') || getValue('updated_at') || now,
      isApproved: getValue('isApproved')?.toLowerCase() === 'true' ||
                  getValue('is_approved')?.toLowerCase() === 'true' ||
                  false,
      reviewCount: this.safeParseInt(getValue('reviewCount') || getValue('review_count'), 0),
    };
  }

  /**
   * Parse [PLAN_DEPENDENCIES] marker to extract dependencies.
   */
  parsePlanDependencies(input: string): PlanDependencies | null {
    const regex = /\[PLAN_DEPENDENCIES\]([\s\S]*?)\[\/PLAN_DEPENDENCIES\]/;
    const match = input.match(regex);

    if (!match) return null;

    const content = match[1].trim();
    const stepDependencies: StepDependency[] = [];
    const externalDependencies: ExternalDependency[] = [];

    // Parse step dependencies: "step-2 -> step-1" or "step-2 depends on step-1"
    // The second capture uses [^\s:] to avoid capturing the colon that precedes the reason
    const stepDepRegex = /(?:^|\n)\s*[-*]?\s*(\S+)\s+(?:->|depends\s+on)\s+([^\s:]+)(?:\s*:\s*(.+))?/gi;
    let depMatch;
    while ((depMatch = stepDepRegex.exec(content)) !== null) {
      stepDependencies.push({
        stepId: depMatch[1],
        dependsOn: depMatch[2],
        reason: depMatch[3]?.trim(),
      });
    }

    // Parse external dependencies section
    const extDepSection = content.match(/external(?:\s+dependencies)?:([\s\S]*?)(?:$|\n\n)/i);
    if (extDepSection) {
      const extLines = extDepSection[1].split('\n');
      for (const line of extLines) {
        // Format: "- name (type): reason [required by: step-1, step-2]"
        const extMatch = line.match(/[-*]\s*(\S+)\s*\((\w+)\)(?:\s*@\s*([^\s:]+))?\s*:\s*(.+?)(?:\s*\[required\s*by:\s*([^\]]+)\])?$/i);
        if (extMatch) {
          externalDependencies.push({
            name: extMatch[1],
            type: extMatch[2] as ExternalDependency['type'],
            version: extMatch[3],
            reason: extMatch[4].trim(),
            requiredBy: extMatch[5]
              ? extMatch[5].split(',').map(s => s.trim()).filter(Boolean)
              : [],
          });
        }
      }
    }

    return {
      stepDependencies,
      externalDependencies,
    };
  }

  /**
   * Parse [PLAN_TEST_COVERAGE] marker to extract test coverage requirements.
   */
  parsePlanTestCoverage(input: string): PlanTestCoverage | null {
    const regex = /\[PLAN_TEST_COVERAGE\]([\s\S]*?)\[\/PLAN_TEST_COVERAGE\]/;
    const match = input.match(regex);

    if (!match) return null;

    const content = match[1].trim();
    const getValue = (key: string): string => {
      const lineMatch = content.match(new RegExp(`${key}:\\s*(.+)`, 'i'));
      return lineMatch ? lineMatch[1].trim() : '';
    };

    // Parse framework
    const framework = getValue('framework') || 'unknown';

    // Parse required test types (comma-separated)
    const requiredTestTypesStr = getValue('requiredTestTypes') || getValue('required_test_types') || getValue('testTypes');
    const requiredTestTypes = requiredTestTypesStr
      ? requiredTestTypesStr.split(',').map(s => s.trim()).filter(Boolean)
      : ['unit'];

    // Parse global coverage target
    const globalCoverageTarget = this.safeParseInt(
      getValue('globalCoverageTarget') || getValue('coverage_target'),
      undefined
    );

    // Parse step-specific coverage
    const stepCoverage: StepTestCoverage[] = [];
    const stepCoverageRegex = /(?:^|\n)\s*[-*]\s*(\S+)\s*:\s*(.+)/g;
    let stepMatch;
    while ((stepMatch = stepCoverageRegex.exec(content)) !== null) {
      const stepId = stepMatch[1];
      const testTypesStr = stepMatch[2];
      // Skip if it looks like a key-value pair we already parsed
      if (['framework', 'requiredtesttypes', 'required_test_types', 'testtypes', 'globalcoveragetarget', 'coverage_target'].includes(stepId.toLowerCase())) {
        continue;
      }
      stepCoverage.push({
        stepId,
        requiredTestTypes: testTypesStr.split(',').map(s => s.trim()).filter(Boolean),
      });
    }

    return {
      framework,
      requiredTestTypes,
      stepCoverage,
      globalCoverageTarget,
    };
  }

  /**
   * Parse [PLAN_ACCEPTANCE_MAPPING] marker to extract acceptance criteria mappings.
   */
  parsePlanAcceptanceMapping(input: string): PlanAcceptanceCriteriaMapping | null {
    const regex = /\[PLAN_ACCEPTANCE_MAPPING\]([\s\S]*?)\[\/PLAN_ACCEPTANCE_MAPPING\]/;
    const match = input.match(regex);

    if (!match) return null;

    const content = match[1].trim();
    const mappings: AcceptanceCriteriaStepMapping[] = [];

    // Parse each mapping line
    // Format: "AC-1: 'Criterion text' -> step-1, step-2 [fully covered]"
    // Or: "- criterion_id: text -> steps [status]"
    const mappingRegex = /(?:^|\n)\s*[-*]?\s*(\S+)\s*:\s*(?:['"]([^'"]+)['"]|([^->]+))\s*->\s*([^[\n]+)(?:\s*\[(fully\s*covered|partial)\])?/gi;
    let mappingMatch;
    while ((mappingMatch = mappingRegex.exec(content)) !== null) {
      const criterionId = mappingMatch[1];
      const criterionText = (mappingMatch[2] || mappingMatch[3] || '').trim();
      const stepsStr = mappingMatch[4];
      const coverageStatus = mappingMatch[5]?.toLowerCase();

      mappings.push({
        criterionId,
        criterionText,
        implementingStepIds: stepsStr.split(',').map(s => s.trim()).filter(Boolean),
        isFullyCovered: coverageStatus === 'fully covered' || coverageStatus === 'fully',
      });
    }

    return {
      mappings,
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Parse a complete composable plan from Claude output.
   * This combines all section parsers and plan steps into a structured ComposablePlan.
   */
  parseComposablePlan(input: string, sessionId?: string): Partial<ComposablePlan> | null {
    const planSteps = this.parsePlanSteps(input);

    // If no plan steps found, return null
    if (planSteps.length === 0) {
      return null;
    }

    // Parse all sections
    const meta = this.parsePlanMeta(input);
    const dependencies = this.parsePlanDependencies(input);
    const testCoverage = this.parsePlanTestCoverage(input);
    const acceptanceMapping = this.parsePlanAcceptanceMapping(input);

    // Convert ParsedPlanStep to PlanStep format
    const steps: PlanStep[] = planSteps.map((step, index) => ({
      id: step.id,
      parentId: step.parentId,
      orderIndex: index,
      title: step.title,
      description: step.description,
      status: step.status as PlanStep['status'],
      metadata: {},
      complexity: step.complexity,
      acceptanceCriteriaIds: step.acceptanceCriteriaIds,
      estimatedFiles: step.estimatedFiles,
    }));

    // Build the partial plan (caller is responsible for validation)
    const now = new Date().toISOString();
    const plan: Partial<ComposablePlan> = {
      meta: meta || {
        version: '1.0.0',
        sessionId: sessionId || '',
        createdAt: now,
        updatedAt: now,
        isApproved: false,
        reviewCount: 0,
      },
      steps,
      dependencies: dependencies || {
        stepDependencies: [],
        externalDependencies: [],
      },
      testCoverage: testCoverage || {
        framework: 'unknown',
        requiredTestTypes: ['unit'],
        stepCoverage: [],
      },
      acceptanceMapping: acceptanceMapping || {
        mappings: [],
        updatedAt: now,
      },
      // Validation status is determined by the caller using PlanValidator
      validationStatus: {
        meta: meta !== null,
        steps: steps.length > 0,
        dependencies: dependencies !== null,
        testCoverage: testCoverage !== null,
        acceptanceMapping: acceptanceMapping !== null,
        overall: false, // Caller should validate and update
      },
    };

    return plan;
  }

  /**
   * Check if the input contains any composable plan markers.
   */
  hasComposablePlanMarkers(input: string): boolean {
    return (
      input.includes('[PLAN_META]') ||
      input.includes('[PLAN_DEPENDENCIES]') ||
      input.includes('[PLAN_TEST_COVERAGE]') ||
      input.includes('[PLAN_ACCEPTANCE_MAPPING]')
    );
  }
}
