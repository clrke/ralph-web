# Stage 3 Execution Implementation Plan

## Summary
Implement Stage 3 that executes approved plan steps sequentially, spawns Claude with write tools, handles blockers with pause/wait, tracks step status, runs tests after each step, and creates git commits per step.

## Design Decisions
- **Execution strategy**: Single Claude spawn executes all steps sequentially with `[STEP_COMPLETE]` markers
- **Git commits**: Commit after each step completion via Bash tool (already available in Stage 3)
- **Blocker handling**: Pause and wait - resume same Claude session after user answers blocker question
- **Auto-start**: Automatically spawn Stage 3 Claude after plan approval
- **Test execution**: Run tests after each step completion
- **Retry on failure**: 3 attempts to fix failing tests before marking step as blocked (tracked in status.json)

## Review Decisions (v1)
- **Bash restrictions**: Accept risk - trust Claude within project context
- **Authentication**: Defer to future - local development tool
- **Blocker resume**: Add Stage 3 branch to batch answers endpoint
- **Blocked UI**: Add blocked status rendering with warning icon
- **Git commit failures**: Accept risk - let Claude handle
- **Concurrent prevention**: Defer to future
- **Real-time progress**: Parse `[IMPLEMENTATION_STATUS]` and broadcast events
- **Retry tracking**: Track in status.json per step
- **Tests**: Defer to separate phase
- **TypeScript types**: Add shared event interfaces
- **Import pattern**: Extend existing import statement

## Review Decisions (v2) - Decision Tracking Feature
- **Decision Tracking scope**: Implement full system now (add steps 21-28 to this plan)
- **Status storage**: Add `status` field to Question type: `'filtered_out' | 'unanswered' | 'answered' | 'documented'`
- **Stage progression rule**: NO stage progression until ALL blocking decisions are DOCUMENTED
- **pending → documented trigger**: Automatic on plan file change detection
- **Tabs UI location**: Replace current QuestionsSection with tabbed interface
- **After submitting answers**: Always return to Stage 2 for plan revision
- **Filtered decisions**: Keep audit trail in separate file (filtered-decisions.json)
- **Duplicate questions**: Improve prompts to document decisions in plan/codebase/README

---

## Implementation Steps

[PLAN_STEP id="step-1" parent="null" status="pending"]
Add Stage 3 event types to shared types
Add TypeScript interfaces to `/shared/types/events.ts` (or create if needed):
- `StepStartedEvent`: { stepId: string, timestamp: string }
- `StepCompletedEvent`: { stepId: string, status: PlanStepStatus, summary: string, filesModified: string[], timestamp: string }
- `ImplementationProgressEvent`: { stepId: string, status: string, filesModified: string[], testsStatus: string | null, retryCount: number, message: string, timestamp: string }
Export from shared/types/index.ts
[/PLAN_STEP]

[PLAN_STEP id="step-2" parent="null" status="pending"]
Add buildStage3Prompt function to stagePrompts.ts
Create the Stage 3 prompt builder in `/server/src/prompts/stagePrompts.ts` that:
- Takes session and approved plan as input
- Includes all plan steps with their IDs, titles, and descriptions
- Instructs Claude to execute steps sequentially using `[STEP_COMPLETE id="X"]` markers
- Requires running tests after each step (max 3 fix attempts before blocking)
- Requires git commit after each successful step
- Specifies `[DECISION_NEEDED category="blocker" immediate="true"]` format for blockers
- Specifies `[IMPLEMENTATION_STATUS]` format for progress updates (parsed in real-time)
- Specifies `[IMPLEMENTATION_COMPLETE]` when all steps are done
- References specific files from plan step descriptions
[/PLAN_STEP]

[PLAN_STEP id="step-3" parent="null" status="pending"]
Add handleStage3Result method to ClaudeResultHandler.ts
Create Stage 3 result handler in `/server/src/services/ClaudeResultHandler.ts` that:
- Saves conversation entry to conversations.json
- Updates plan.steps[] status based on `result.parsed.stepsCompleted`
- Marks steps as 'completed', 'in_progress', or 'blocked'
- Tracks retry count per step in status.json (stepRetries: Record<string, number>)
- When retryCount >= 3, mark step as 'blocked' instead of allowing more retries
- Extracts blocker questions from `result.parsed.decisions` with category="blocker"
- Saves blocker questions to questions.json (reusing existing saveQuestions pattern)
- Updates status.json with currentStepId and execution status
- Detects `result.parsed.implementationComplete` for Stage 3→4 transition trigger
[/PLAN_STEP]

[PLAN_STEP id="step-4" parent="null" status="pending"]
Add step completion events to EventBroadcaster
Add new methods to `/server/src/services/EventBroadcaster.ts`:
- `stepStarted(projectId, featureId, stepId)` - emits 'step.started' event
- `stepCompleted(projectId, featureId, step, summary, filesModified)` - emits 'step.completed' event
- `implementationProgress(projectId, featureId, status)` - emits 'implementation.progress' with current step, files modified, test status, retry count
Use the new shared type interfaces for event payloads
[/PLAN_STEP]

[PLAN_STEP id="step-5" parent="null" status="pending"]
Add spawnStage3Implementation helper function to app.ts
Create the Stage 3 spawn helper in `/server/src/app.ts` following the `spawnStage2Review` pattern:
- Takes session, storage, sessionManager, resultHandler, eventBroadcaster, prompt
- Updates status.json to 'running' with 'stage3_started' action
- Broadcasts `executionStatus` event for running state
- Spawns Claude with `orchestrator.getStageTools(3)` (includes Bash for git)
- Uses `session.claudeSessionId` for `--resume` if available
- Pipes output to `eventBroadcaster.claudeOutput()`
- **NEW**: Parse `[IMPLEMENTATION_STATUS]` markers from streaming output and broadcast `implementationProgress` events in real-time
- Calls `resultHandler.handleStage3Result()` on completion
- Broadcasts step completion events and plan updates
- Handles Stage 3→4 transition when implementation complete
[/PLAN_STEP]

[PLAN_STEP id="step-6" parent="null" status="pending"]
Wire up auto-start in handleStage2Completion
Modify `handleStage2Completion()` in `/server/src/app.ts` to:
- After transitioning to Stage 3 and broadcasting stageChanged
- Read the approved plan from storage
- Build Stage 3 prompt using `buildStage3Prompt(updatedSession, plan)`
- Call `spawnStage3Implementation()` to auto-start execution
- Extend existing import on line 10 to include `buildStage3Prompt`
[/PLAN_STEP]

[PLAN_STEP id="step-7" parent="null" status="pending"]
Add Stage 3 blocker resume handling to batch answers endpoint
Modify the batch answers endpoint fire-and-forget block in `/server/src/app.ts` (around line 562-573):
- Add `else if (session.currentStage === 3)` branch after the Stage 2 handling
- Build continuation prompt with blocker answer context using `buildBatchAnswersContinuationPrompt`
- Call `spawnStage3Implementation()` to resume execution with the blocker answer
- Ensure claudeSessionId is passed for session resume
[/PLAN_STEP]

[PLAN_STEP id="step-8" parent="null" status="pending"]
Add Stage 3 transition endpoint support
Update the transition endpoint in `/server/src/app.ts` for manual Stage 3 triggering:
- Add `else if (targetStage === 3)` case in the transition handler (after line 438)
- Read plan and verify `plan.isApproved === true` before allowing transition
- Build Stage 3 prompt and call `spawnStage3Implementation()`
- Mirror the pattern used for `targetStage === 2`
[/PLAN_STEP]

[PLAN_STEP id="step-9" parent="null" status="pending"]
Add handleStage3Completion for Stage 3→4 transition
Create `handleStage3Completion()` in `/server/src/app.ts`:
- Triggered when `result.parsed.implementationComplete` is true
- Verify all plan steps are marked as 'completed'
- Transition to Stage 4 using `sessionManager.transitionStage()`
- Broadcast `stageChanged` event
- Log completion summary with step count and files modified
[/PLAN_STEP]

[PLAN_STEP id="step-10" parent="null" status="pending"]
Update sessionStore for Stage 3 state management
Add to `/client/src/stores/sessionStore.ts`:
- `updateStepStatus(stepId: string, status: PlanStepStatus)` action to update individual step status in plan.steps
- `setImplementationProgress(progress: ImplementationProgressEvent)` action for real-time progress tracking
- Add `implementationProgress` state field to store current progress
- Ensure plan updates from socket events properly merge step statuses
[/PLAN_STEP]

[PLAN_STEP id="step-11" parent="null" status="pending"]
Add client socket handlers for Stage 3 events
Update `/client/src/pages/SessionView.tsx` to:
- Add `handleStepStarted` callback for 'step.started' event - calls `updateStepStatus(stepId, 'in_progress')`
- Add `handleStepCompleted` callback for 'step.completed' event - calls `updateStepStatus(stepId, status)`
- Add `handleImplementationProgress` callback for 'implementation.progress' event - calls `setImplementationProgress(data)`
- Register all handlers in useEffect socket.on() block (around line 87-98)
- Add cleanup in useEffect return (socket.off for each handler)
[/PLAN_STEP]

[PLAN_STEP id="step-12" parent="null" status="pending"]
Add blocked status rendering to ImplementationSection
Update the `ImplementationSection` component in `/client/src/pages/SessionView.tsx`:
- Add rendering case for `step.status === 'blocked'` with warning/alert icon
- Show orange/yellow background color for blocked steps (e.g., `bg-yellow-900/20`)
- Display "Waiting for input" or similar text indicating user action needed
- Optionally show retry count from implementation progress if available
- Add `needs_review` status rendering with similar warning treatment
[/PLAN_STEP]

---

## Stage 5 Review Fix Steps (v3)

[PLAN_STEP id="step-13" parent="null" status="pending"]
Replace Tree View with Timeline View
Remove the current ReactFlow "visual" view in `/client/src/pages/SessionView.tsx` and `/client/src/components/PlanEditor/`. Implement a Timeline View that shows:
- Sequential steps in a vertical timeline format
- Step status indicators (pending, in_progress, completed, blocked)
- Timestamps for started/completed steps
- Progress connecting lines between steps
- Current step highlighted
Keep the List view as an alternative. Update view mode toggle from 'visual'/'list' to 'timeline'/'list'.
[/PLAN_STEP]

[PLAN_STEP id="step-14" parent="null" status="pending"]
Implement Circuit Breaker Pattern (following ralph-claude-code)
Create `/server/src/services/CircuitBreaker.ts` following the ralph-claude-code pattern:
- 3-state machine: CLOSED (normal), HALF_OPEN (monitoring), OPEN (halted)
- State file: `.circuit_breaker_state` in session directory with JSON format
- History file: `.circuit_breaker_history` tracking all state transitions
- Thresholds: NO_PROGRESS_THRESHOLD=3, SAME_ERROR_THRESHOLD=5
- Functions: `initCircuitBreaker()`, `recordLoopResult(filesChanged, hasErrors)`, `canExecute()`, `shouldHaltExecution()`, `resetCircuitBreaker()`
- Transition logic: CLOSED→HALF_OPEN at 2 no-progress, CLOSED→OPEN at 3, HALF_OPEN→CLOSED on progress detected
- Integration: Call from spawn helpers in app.ts before spawning Claude
[/PLAN_STEP]

[PLAN_STEP id="step-15" parent="null" status="pending"]
Implement Log Rotation per README spec
Create `/server/src/services/LogRotation.ts` with:
- Configuration: LOG_MAX_SIZE_MB=50, LOG_MAX_FILES=10, LOG_RETENTION_DAYS=30
- Function: `rotateLogFile(filePath)` - rotate when file exceeds max size
- Function: `cleanupOldLogs(directory)` - delete logs older than retention days
- Function: `checkAndRotate(filePath)` - check size and rotate if needed
- Apply to: conversations.json, status.json activity logs
- Integrate with FileStorageService for automatic rotation on write
[/PLAN_STEP]

[PLAN_STEP id="step-16" parent="null" status="pending"]
Fix Stage 4 PR Verification with gh pr command
Update `spawnStage4PRCreation()` in `/server/src/app.ts`:
- After Claude completes, run `gh pr list --head <branch> --json number,url` to verify PR exists
- Parse JSON output to extract PR number and URL
- Remove reliance on `[PR_CREATED]` marker parsing
- Update session with actual PR URL from GitHub API response
- Broadcast pr.created event with verified PR data
- Handle case where PR already exists (reuse existing PR)
[/PLAN_STEP]

[PLAN_STEP id="step-17" parent="null" status="pending"]
Add Mutex/Lock Around Spawn Logic
Create `/server/src/services/SpawnLock.ts`:
- In-memory lock map: `Map<string, { locked: boolean, acquiredAt: Date }>`
- Function: `acquireLock(sessionId): boolean` - returns false if already locked
- Function: `releaseLock(sessionId): void` - release the lock
- Function: `isLocked(sessionId): boolean` - check lock status
- Add timeout: auto-release after 10 minutes (safety)
Update batch answers endpoint in `/server/src/app.ts`:
- Acquire lock before spawning Stage 2/3
- Release lock in finally block after spawn completes
- Return 409 Conflict if lock already held
[/PLAN_STEP]

[PLAN_STEP id="step-18" parent="null" status="pending"]
Escape Special Markers in User Input
Create `/server/src/utils/sanitizeInput.ts`:
- Function: `escapeMarkers(text: string): string`
- Escape patterns: `[PLAN_APPROVED]`, `[PR_APPROVED]`, `[DECISION_NEEDED`, `[STEP_COMPLETE`, `[IMPLEMENTATION_COMPLETE]`, `[PR_CREATED]`, `[PLAN_FILE`
- Replace `[` with `\[` only for these specific markers
- Apply in prompt builders: buildStage1Prompt, buildStage2Prompt, buildStage3Prompt, buildStage4Prompt, buildStage5Prompt
- Sanitize: session.title, session.featureDescription, session.technicalNotes, remarks parameter
[/PLAN_STEP]

[PLAN_STEP id="step-19" parent="null" status="pending"]
Add Tests for Haiku Subprocess Services
Create test files for untested services:

`/tests/unit/DecisionValidator.test.ts`:
- Test validateQuestions with valid/invalid questions
- Test Haiku subprocess spawning
- Test JSON parsing of Haiku response
- Test timeout handling
- Test error recovery

`/tests/unit/TestRequirementAssessor.test.ts`:
- Test assessTestRequirements with different codebases
- Test subprocess spawning and output parsing
- Test timeout handling

`/tests/unit/IncompleteStepsAssessor.test.ts`:
- Test assessIncompleteSteps with various plan states
- Test subprocess spawning and output parsing
- Test edge cases (empty plans, all complete, all incomplete)

Mock subprocess spawning using jest.mock for unit tests.
[/PLAN_STEP]

[PLAN_STEP id="step-20" parent="null" status="pending"]
Add Missing Socket Event Type Definitions
Update `/client/src/services/socket.ts` SocketEvents interface to add:
- 'step.started': { stepId: string, timestamp: string }
- 'step.completed': { stepId, status, summary, filesModified, timestamp }
- 'implementation.progress': { stepId, status, filesModified, testsStatus, retryCount, message, timestamp }
- 'pr.created': { prNumber, prUrl, timestamp }
Also add `reviewCount?: number` to 'plan.updated' event type.
[/PLAN_STEP]

---

## Decision Tracking Feature (v2)

[PLAN_STEP id="step-21" parent="null" status="pending"]
Add status field to Question type
Update `/shared/types/questions.ts`:
- Add `status: DecisionStatus` field to Question interface
- Create `DecisionStatus` type: `'filtered_out' | 'unanswered' | 'answered' | 'documented'`
- Add `lastSubmittedAt?: string` field for re-submit tracking (5-minute rule)
- Add `documentedAt?: string` field for when decision was written to plan
- Export DecisionStatus from shared/types/index.ts
[/PLAN_STEP]

[PLAN_STEP id="step-22" parent="null" status="pending"]
Add filtered decisions audit trail
Create `/server/src/services/FilteredDecisionsLog.ts`:
- Function: `logFilteredDecision(sessionDir, question, reason)` - save to filtered-decisions.json
- Function: `getFilteredDecisions(sessionDir)` - read audit log
- Structure: `{ id, questionText, filteredAt, reason, originalDecision }`
- Update DecisionValidator to call logFilteredDecision when filtering
[/PLAN_STEP]

[PLAN_STEP id="step-23" parent="null" status="pending"]
Add decision status transition logic
Create `/server/src/services/DecisionStatusManager.ts`:
- Function: `markAsAnswered(sessionDir, questionId, answer)` - unanswered → answered
- Function: `markAsDocumented(sessionDir, questionId)` - answered → documented
- Function: `getUndocumentedDecisions(sessionDir)` - return all non-documented decisions
- Function: `canProgressToNextStage(sessionDir)` - check all blocking decisions are documented
- Integrate with ClaudeResultHandler.saveQuestions to set initial status='unanswered'
[/PLAN_STEP]

[PLAN_STEP id="step-24" parent="null" status="pending"]
Add automatic documented detection on plan file change
Update `/server/src/services/ClaudeResultHandler.ts`:
- After saving plan.json, check if any answered decisions are now documented
- Parse plan content for decision references (question IDs or text matches)
- Call DecisionStatusManager.markAsDocumented for matching decisions
- Broadcast 'decision.documented' event when status changes
[/PLAN_STEP]

[PLAN_STEP id="step-25" parent="null" status="pending"]
Block stage transitions on undocumented decisions
Update `/server/src/app.ts` transition endpoint:
- Before ANY stage transition, call DecisionStatusManager.canProgressToNextStage()
- If returns false, return 400 with list of undocumented decisions
- Add check in handleStage2Completion before transitioning to Stage 3
- Add check in handleStage3Completion before transitioning to Stage 4
- Add check in all manual transition handlers
[/PLAN_STEP]

[PLAN_STEP id="step-26" parent="null" status="pending"]
Update batch answers to return to Stage 2
Modify batch answers endpoint in `/server/src/app.ts`:
- After marking decisions as 'answered', always transition to Stage 2
- Remove stage-specific resume logic (Stage 3 blocker resume)
- Call sessionManager.transitionStage(projectId, featureId, 2)
- Broadcast stageChanged event
- Set status to 'idle' waiting for Claude to document decisions
[/PLAN_STEP]

[PLAN_STEP id="step-27" parent="null" status="pending"]
Replace QuestionsSection with DecisionTabs UI
Update `/client/src/pages/SessionView.tsx`:
- Create DecisionTabs component with 4 tabs: Filtered | Unanswered | Answered | Documented
- Each tab shows count badge: `Unanswered (3)`
- Unanswered tab: Show decision cards with answer selection and Submit button
- Answered tab: Show decisions pending documentation with Re-submit button (if lastSubmittedAt > 5 min ago)
- Documented tab: Show completed decisions (read-only)
- Filtered tab: Show audit log from filtered-decisions.json
[/PLAN_STEP]

[PLAN_STEP id="step-28" parent="null" status="pending"]
Add decision socket events and store actions
Update `/client/src/stores/sessionStore.ts`:
- Add `decisions` state field grouped by status
- Add `updateDecisionStatus(id, status)` action
- Add `setDecisions(decisions)` action
Update `/client/src/services/socket.ts`:
- Add 'decision.answered' event type
- Add 'decision.documented' event type
- Add 'decisions.updated' event type (full refresh)
Update SessionView.tsx to handle new socket events
[/PLAN_STEP]

---

## Files to Modify

| File | Changes |
|------|---------|
| `shared/types/events.ts` | Add Stage 3 event interfaces (new file or extend existing) |
| `shared/types/questions.ts` | Add `status: DecisionStatus` field, `lastSubmittedAt`, `documentedAt` |
| `shared/types/index.ts` | Export new event types and DecisionStatus |
| `server/src/prompts/stagePrompts.ts` | Add `buildStage3Prompt()` function |
| `server/src/services/ClaudeResultHandler.ts` | Add `handleStage3Result()`, auto-document detection |
| `server/src/services/EventBroadcaster.ts` | Add step events, decision events |
| `server/src/services/FilteredDecisionsLog.ts` | NEW: Audit trail for filtered decisions |
| `server/src/services/DecisionStatusManager.ts` | NEW: Decision lifecycle state management |
| `server/src/app.ts` | Add spawn helpers, block transitions on undocumented decisions, always return to Stage 2 |
| `client/src/stores/sessionStore.ts` | Add step status, implementation progress, decision state |
| `client/src/pages/SessionView.tsx` | Replace QuestionsSection with DecisionTabs, add socket handlers |
| `client/src/services/socket.ts` | Add decision event types |

## Testing Strategy (Deferred)
- Unit test `buildStage3Prompt()` generates correct marker instructions
- Unit test `handleStage3Result()` correctly updates step statuses and tracks retries
- Integration test: Create session → answer questions → approve plan → verify Stage 3 auto-starts
- Integration test: Simulate blocker → answer → verify resume
- E2E test: Full flow through Stage 3 with actual file modifications
