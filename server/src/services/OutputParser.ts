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
}

export interface ParsedMarker {
  decisions: ParsedDecision[];
  planSteps: ParsedPlanStep[];
  stepCompleted: ParsedStepComplete | null;
  stepsCompleted: ParsedStepComplete[];
  planModeEntered: boolean;
  planModeExited: boolean;
  planFilePath: string | null;
  implementationComplete: boolean;
  implementationSummary: string | null;
  implementationStatus: ParsedImplementationStatus | null;
  prCreated: ParsedPRCreated | null;
}

export class OutputParser {
  parse(input: string): ParsedMarker {
    const stepsCompleted = this.parseAllStepsComplete(input);
    return {
      decisions: this.parseDecisions(input),
      planSteps: this.parsePlanSteps(input),
      stepCompleted: stepsCompleted.length > 0 ? stepsCompleted[stepsCompleted.length - 1] : null,
      stepsCompleted,
      planModeEntered: input.includes('[PLAN_MODE_ENTERED]'),
      planModeExited: input.includes('[PLAN_MODE_EXITED]'),
      planFilePath: this.parsePlanFile(input),
      implementationComplete: input.includes('[IMPLEMENTATION_COMPLETE]'),
      implementationSummary: this.parseImplementationSummary(input),
      implementationStatus: this.parseImplementationStatus(input),
      prCreated: this.parsePRCreated(input),
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

      for (const line of lines) {
        const optionMatch = line.match(/^-\s+(?:Option\s+\w+:\s+)?(.+?)(?:\s+\(recommended\))?$/i);
        if (optionMatch) {
          const isRecommended = line.toLowerCase().includes('(recommended)');
          const label = optionMatch[1].replace(/\s*\(recommended\)\s*/i, '').trim();
          options.push({ label, recommended: isRecommended });
        } else if (line.trim()) {
          questionLines.push(line);
        }
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

  private parsePlanSteps(input: string): ParsedPlanStep[] {
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
    const regex = /\[STEP_COMPLETE\s+id="([^"]+)"\]([\s\S]*?)\[\/STEP_COMPLETE\]/g;

    let match;
    while ((match = regex.exec(input)) !== null) {
      steps.push({
        id: match[1],
        summary: match[2].trim(),
      });
    }

    return steps;
  }

  private parsePlanFile(input: string): string | null {
    const regex = /\[PLAN_FILE\s+path="([^"]+)"\]/;
    const match = input.match(regex);
    return match ? match[1] : null;
  }

  private parseImplementationSummary(input: string): string | null {
    const regex = /\[IMPLEMENTATION_COMPLETE\]([\s\S]*?)\[\/IMPLEMENTATION_COMPLETE\]/;
    const match = input.match(regex);
    return match ? match[1].trim() : null;
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

    return {
      title: titleMatch ? titleMatch[1].trim() : '',
      sourceBranch: branchMatch ? branchMatch[1] : '',
      targetBranch: branchMatch ? branchMatch[2] : '',
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
}
