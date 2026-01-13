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
            const label = optionMatch[1].replace(/\s*\(recommended\)\s*/i, '').trim();
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

      steps.push({
        id: attrs.id || '',
        parentId: attrs.parent === 'null' ? null : (attrs.parent || null),
        status: attrs.status || 'pending',
        title: lines[0] || '',
        description: lines.slice(1).join('\n').trim(),
      });
    }

    return steps;
  }

  private parseAllStepsComplete(input: string): ParsedStepComplete[] {
    const steps: ParsedStepComplete[] = [];
    const seenIds = new Set<string>();

    // Primary: Parse formal [STEP_COMPLETE] markers
    const formalRegex = /\[STEP_COMPLETE\s+id="([^"]+)"\]([\s\S]*?)\[\/STEP_COMPLETE\]/g;
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
}
