# TDD Plan: Fix PR #1 Review Issues

## Approach
For each issue, we follow strict TDD:
1. Write failing test(s) that expose the bug/missing feature
2. Run tests to confirm they fail
3. Implement the fix
4. Run tests to confirm they pass
5. Refactor if needed

---

## Phase 1: FileStorageService Security & Reliability

### 1.1 Path Traversal Prevention (CRITICAL)
**Tests to add:**
```typescript
describe('path traversal prevention', () => {
  it('should throw PathTraversalError for ../../../etc/passwd', async () => {
    await expect(service.readJson('../../../etc/passwd')).rejects.toThrow('PathTraversalError');
  });

  it('should throw PathTraversalError for absolute paths outside baseDir', async () => {
    await expect(service.readJson('/etc/passwd')).rejects.toThrow('PathTraversalError');
  });

  it('should allow paths that resolve within baseDir', async () => {
    await service.writeJson('subdir/../file.json', { test: true });
    const result = await service.readJson('file.json');
    expect(result).toEqual({ test: true });
  });
});
```

**Implementation:** Add path validation in `resolvePath()` using `path.resolve()` and checking prefix.

### 1.2 Temp File Cleanup on Failure
**Tests to add:**
```typescript
it('should clean up temp file when writeJson fails during rename', async () => {
  // Mock fs.rename to fail
  const files = await fs.readdir(testDir);
  const tempFiles = files.filter(f => f.includes('.tmp.'));
  expect(tempFiles).toHaveLength(0);
});
```

**Implementation:** Wrap write in try/catch, cleanup temp file in catch block.

### 1.3 Random Suffix for Temp Files
**Tests to add:**
```typescript
it('should use unique temp file names for rapid successive writes', async () => {
  // Write same file multiple times rapidly
  await Promise.all([
    service.writeJson('file.json', { v: 1 }),
    service.writeJson('file.json', { v: 2 }),
    service.writeJson('file.json', { v: 3 }),
  ]);
  // Should not have collisions (test would fail with collision)
});
```

**Implementation:** Add crypto.randomBytes suffix to temp filename.

---

## Phase 2: SessionManager Data Integrity

### 2.1 Empty FeatureId Prevention
**Tests to add:**
```typescript
describe('getFeatureId edge cases', () => {
  it('should throw for empty title', () => {
    expect(() => manager.getFeatureId('')).toThrow('alphanumeric');
  });

  it('should throw for title with only special characters', () => {
    expect(() => manager.getFeatureId('!@#$%^&*()')).toThrow('alphanumeric');
  });

  it('should truncate very long titles to 64 chars', () => {
    const longTitle = 'a'.repeat(100);
    expect(manager.getFeatureId(longTitle).length).toBeLessThanOrEqual(64);
  });

  it('should remove leading and trailing dashes', () => {
    expect(manager.getFeatureId('--test--')).toBe('test');
  });
});
```

### 2.2 Session Collision Prevention
**Tests to add:**
```typescript
it('should throw when creating duplicate session', async () => {
  await manager.createSession({ title: 'Test', projectPath: '/test', featureDescription: 'desc' });
  await expect(
    manager.createSession({ title: 'Test', projectPath: '/test', featureDescription: 'desc' })
  ).rejects.toThrow('already exists');
});

it('should throw when titles normalize to same featureId', async () => {
  await manager.createSession({ title: 'Add Auth', projectPath: '/test', featureDescription: 'desc' });
  await expect(
    manager.createSession({ title: 'ADD AUTH!', projectPath: '/test', featureDescription: 'desc' })
  ).rejects.toThrow('already exists');
});
```

### 2.3 Protected Fields in updateSession
**Tests to add:**
```typescript
it('should not allow updating protected fields', async () => {
  const session = await manager.createSession({...});
  const updated = await manager.updateSession(projectId, featureId, {
    id: 'hacked-id',
    projectId: 'hacked-project',
    createdAt: '1970-01-01',
  });
  expect(updated.id).toBe(session.id); // unchanged
  expect(updated.projectId).toBe(session.projectId); // unchanged
  expect(updated.createdAt).toBe(session.createdAt); // unchanged
});
```

### 2.4 Input Validation
**Tests to add:**
```typescript
it('should throw for empty title in createSession', async () => {
  await expect(manager.createSession({ title: '', projectPath: '/test', featureDescription: 'desc' }))
    .rejects.toThrow('Title is required');
});

it('should throw for empty projectPath', async () => {
  await expect(manager.createSession({ title: 'Test', projectPath: '', featureDescription: 'desc' }))
    .rejects.toThrow('Project path is required');
});
```

### 2.5 SHA256 for ProjectId
**Tests to add:**
```typescript
it('should generate consistent 32-char projectId using SHA256', () => {
  const id1 = manager.getProjectId('/path/to/project');
  const id2 = manager.getProjectId('/path/to/project');
  expect(id1).toBe(id2);
  expect(id1.length).toBe(32);
  // Verify it's not MD5 by checking known hash
});
```

---

## Phase 3: ClaudeOrchestrator Reliability

### 3.1 Double Promise Settlement Prevention
**Tests to add:**
```typescript
it('should not reject twice when both error and close events fire', async () => {
  // Setup mock to emit both error and close
  mockSpawn.mockImplementation(() => {
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    setTimeout(() => {
      proc.emit('error', new Error('spawn error'));
      proc.emit('close', 1);
    }, 10);
    return proc;
  });

  // Should only reject once, not cause unhandled rejection
  await expect(orchestrator.spawn({...})).rejects.toThrow('spawn error');
});
```

### 3.2 Exit Code Handling
**Tests to add:**
```typescript
it('should reject when exit code is non-zero even with valid JSON', async () => {
  mockSpawn.mockImplementation(() => {
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    setTimeout(() => {
      proc.stdout.emit('data', Buffer.from(JSON.stringify({ is_error: false, result: 'ok' })));
      proc.emit('close', 1); // non-zero exit
    }, 10);
    return proc;
  });

  await expect(orchestrator.spawn({...})).rejects.toThrow(/exit code/i);
});
```

### 3.3 Include stderr in Errors
**Tests to add:**
```typescript
it('should include stderr content in error message', async () => {
  mockSpawn.mockImplementation(() => {
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    setTimeout(() => {
      proc.stderr.emit('data', Buffer.from('Permission denied'));
      proc.emit('close', 1);
    }, 10);
    return proc;
  });

  await expect(orchestrator.spawn({...})).rejects.toThrow(/Permission denied/);
});
```

### 3.4 Chunked Output Handling
**Tests to add:**
```typescript
it('should concatenate chunked stdout correctly', async () => {
  const fullJson = JSON.stringify({ is_error: false, result: 'success' });
  const chunk1 = fullJson.substring(0, 10);
  const chunk2 = fullJson.substring(10);

  mockSpawn.mockImplementation(() => {
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    setTimeout(() => {
      proc.stdout.emit('data', Buffer.from(chunk1));
      proc.stdout.emit('data', Buffer.from(chunk2));
      proc.emit('close', 0);
    }, 10);
    return proc;
  });

  const result = await orchestrator.spawn({...});
  expect(result.result).toBe('success');
});
```

---

## Phase 4: OutputParser Correctness

### 4.1 Multiple STEP_COMPLETE Markers
**Tests to add:**
```typescript
it('should parse all STEP_COMPLETE markers, not just first', () => {
  const input = `
    [STEP_COMPLETE id="step-1"]Summary 1[/STEP_COMPLETE]
    [STEP_COMPLETE id="step-2"]Summary 2[/STEP_COMPLETE]
  `;
  const result = parser.parse(input);
  expect(result.stepsCompleted).toHaveLength(2);
  expect(result.stepsCompleted[0].id).toBe('step-1');
  expect(result.stepsCompleted[1].id).toBe('step-2');
});
```

### 4.2 Escaped Quotes in Attributes
**Tests to add:**
```typescript
it('should handle escaped quotes in attribute values', () => {
  const input = '[DECISION_NEEDED priority="1" file="path/to/\\"file\\".ts"]Question[/DECISION_NEEDED]';
  const result = parser.parse(input);
  expect(result.decisions[0].file).toBe('path/to/"file".ts');
});
```

### 4.3 parseInt Validation
**Tests to add:**
```typescript
it('should default to valid values when parseInt returns NaN', () => {
  const input = '[DECISION_NEEDED priority="invalid"]Question[/DECISION_NEEDED]';
  const result = parser.parse(input);
  expect(result.decisions[0].priority).toBe(3); // default priority
});
```

---

## Phase 5: React Client Fixes (Full TDD)

### 5.0 Setup Vitest + React Testing Library
**Dependencies to add:**
```bash
npm install -D vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom @vitejs/plugin-react
```

**Create `client/vitest.config.ts`:**
```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
  },
});
```

**Create `client/src/test/setup.ts`:**
```typescript
import '@testing-library/jest-dom';
```

### 5.1 Store Race Conditions
**Tests to add (`client/src/stores/sessionStore.test.ts`):**
```typescript
describe('sessionStore', () => {
  describe('fetchSession race conditions', () => {
    it('should cancel previous request when new fetch starts', async () => {
      // Mock fetch to delay first request
      let firstRequestCompleted = false;
      global.fetch = vi.fn()
        .mockImplementationOnce(() => new Promise(resolve => {
          setTimeout(() => {
            firstRequestCompleted = true;
            resolve({ ok: true, json: () => ({ id: 'old' }) });
          }, 100);
        }))
        .mockImplementationOnce(() => Promise.resolve({
          ok: true,
          json: () => ({ id: 'new' }),
        }));

      const { fetchSession } = useSessionStore.getState();

      // Start first fetch, then immediately start second
      fetchSession('proj1', 'feat1');
      await fetchSession('proj2', 'feat2');

      // Should have new data, not old
      expect(useSessionStore.getState().session?.id).toBe('new');
    });

    it('should not update state if request was aborted', async () => {
      // Similar test for aborted requests
    });
  });

  describe('error handling', () => {
    it('should clear error on new action', async () => {
      useSessionStore.setState({ error: 'previous error' });
      const { fetchSession } = useSessionStore.getState();

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => ({}),
      });

      await fetchSession('proj', 'feat');
      expect(useSessionStore.getState().error).toBeNull();
    });
  });

  describe('requestPlanChanges', () => {
    it('should update plan state after successful request', async () => {
      const mockPlan = { id: 'plan-1', steps: [] };
      useSessionStore.setState({
        session: { projectId: 'proj', featureId: 'feat' },
        plan: { id: 'old-plan' },
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => mockPlan,
      });

      await useSessionStore.getState().requestPlanChanges('update X');
      expect(useSessionStore.getState().plan?.id).toBe('plan-1');
    });
  });
});
```

**Implementation:** Add AbortController, clear errors, update state after requestPlanChanges.

### 5.2 PlanEditor Node Updates
**Tests to add (`client/src/components/PlanEditor/PlanEditor.test.tsx`):**
```typescript
describe('PlanEditor', () => {
  it('should update nodes when plan.steps changes', async () => {
    const initialPlan = {
      steps: [{ id: 'step-1', title: 'Step 1', status: 'pending' }],
    };

    const { rerender } = render(<PlanEditor plan={initialPlan} />);

    // Verify initial state
    expect(screen.getByText('Step 1')).toBeInTheDocument();

    // Update plan
    const updatedPlan = {
      steps: [
        { id: 'step-1', title: 'Step 1', status: 'completed' },
        { id: 'step-2', title: 'Step 2', status: 'pending' },
      ],
    };

    rerender(<PlanEditor plan={updatedPlan} />);

    // Verify updates reflected
    expect(screen.getByText('Step 2')).toBeInTheDocument();
    // Verify step-1 shows completed status (check for checkmark icon)
  });

  it('should call onStepSelect when node is clicked', async () => {
    const onStepSelect = vi.fn();
    const plan = {
      steps: [{ id: 'step-1', title: 'Step 1', status: 'pending' }],
    };

    render(<PlanEditor plan={plan} onStepSelect={onStepSelect} />);

    // Click on node (may need to query React Flow internals)
    await userEvent.click(screen.getByText('Step 1'));

    expect(onStepSelect).toHaveBeenCalledWith(plan.steps[0]);
  });
});
```

**Implementation:** Use `useEffect` to sync nodes/edges when plan changes.

### 5.3 NewSession Error UI
**Tests to add (`client/src/pages/NewSession.test.tsx`):**
```typescript
describe('NewSession', () => {
  it('should display error message when submission fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    render(<NewSession />);

    // Fill form
    await userEvent.type(screen.getByLabelText(/project path/i), '/test/path');
    await userEvent.type(screen.getByLabelText(/feature title/i), 'Test Feature');
    await userEvent.type(screen.getByLabelText(/description/i), 'Test description');

    // Submit
    await userEvent.click(screen.getByRole('button', { name: /start discovery/i }));

    // Should show error
    expect(await screen.findByRole('alert')).toHaveTextContent(/failed to create session/i);
  });

  it('should clear error when user starts typing again', async () => {
    // Set up error state first, then verify it clears
  });

  it('should validate required fields before submission', async () => {
    render(<NewSession />);

    // Try to submit empty form
    await userEvent.click(screen.getByRole('button', { name: /start discovery/i }));

    // Should show validation errors
    expect(screen.getByText(/project path is required/i)).toBeInTheDocument();
  });
});
```

**Implementation:** Add error state, display error alert, add client-side validation.

### 5.4 SessionView Fixes
**Tests to add (`client/src/pages/SessionView.test.tsx`):**
```typescript
describe('SessionView', () => {
  it('should support all question types', async () => {
    // Mock store with different question types
    useSessionStore.setState({
      session: { projectId: 'proj', featureId: 'feat', currentStage: 1 },
      questions: [
        { id: 'q1', questionType: 'single_choice', questionText: 'Choose one', options: [...] },
        { id: 'q2', questionType: 'multi_choice', questionText: 'Choose many', options: [...] },
        { id: 'q3', questionType: 'text', questionText: 'Enter text' },
        { id: 'q4', questionType: 'confirmation', questionText: 'Confirm?' },
      ],
    });

    render(<SessionView />);

    // Verify all question types render correctly
    expect(screen.getByText('Choose one')).toBeInTheDocument();
    expect(screen.getByText('Choose many')).toBeInTheDocument();
    expect(screen.getByText('Enter text')).toBeInTheDocument();
    expect(screen.getByText('Confirm?')).toBeInTheDocument();
  });

  it('should show loading state for individual actions', async () => {
    // Test that approve button shows loading spinner
  });
});
```

### 5.5 Move Type Imports (No Test Needed)
**Fix:** Move imports from bottom of SessionView.tsx to top. This is a code style fix, verified by TypeScript compilation.

---

## Phase 6: Shared Types

### 6.1 Add Missing PlanStepStatus
```typescript
export type PlanStepStatus = 'pending' | 'in_progress' | 'completed' | 'blocked' | 'skipped' | 'needs_review';
```

### 6.2 Remove Duplicate answeredAt
Keep only `Question.answeredAt`, remove from `QuestionAnswer`.

### 6.3 Make acceptanceCriteria Required
```typescript
export interface CreateSessionInput {
  acceptanceCriteria: AcceptanceCriterion[]; // Remove optional
}
```

---

## Phase 7: CI/Build Configuration

### 7.1 Add ESLint Configuration
Create `.eslintrc.js` with TypeScript + React rules.

### 7.2 Add Lint Step to CI
Add `npm run lint` step before tests.

### 7.3 Add Security Audit
Add `npm audit --audit-level=high` step.

### 7.4 Add Coverage Upload
Add Codecov integration.

---

## Phase 8: Accessibility

### 8.1 Form Labels
Add `id` to inputs and `htmlFor` to labels.

### 8.2 Icon Buttons
Add `aria-label` to all icon-only buttons.

### 8.3 Keyboard Navigation
Add `tabIndex` and keyboard handlers to React Flow nodes.

---

## Execution Order

1. **Phase 1** - FileStorageService (foundation, security critical)
2. **Phase 2** - SessionManager (depends on FileStorageService)
3. **Phase 3** - ClaudeOrchestrator (independent)
4. **Phase 4** - OutputParser (independent)
5. **Phase 6** - Shared Types (may affect other phases)
6. **Phase 5.0** - Setup Vitest + React Testing Library
7. **Phase 5.1-5.5** - React Client TDD
8. **Phase 7** - CI/Build (add frontend tests to CI)
9. **Phase 8** - Accessibility (final polish, with tests)

---

## Success Criteria

- All new backend tests pass (Jest)
- All new frontend tests pass (Vitest)
- All existing 62 tests still pass
- No TypeScript errors in server or client
- CI passes with both test suites
- Code coverage maintained or improved

---

## Test Count Estimates

| Phase | New Tests |
|-------|-----------|
| Phase 1: FileStorageService | ~5 |
| Phase 2: SessionManager | ~10 |
| Phase 3: ClaudeOrchestrator | ~5 |
| Phase 4: OutputParser | ~4 |
| Phase 5: React Client | ~15 |
| Phase 8: Accessibility | ~5 |
| **Total New Tests** | **~44** |
| **Existing Tests** | **62** |
| **Final Total** | **~106** |
