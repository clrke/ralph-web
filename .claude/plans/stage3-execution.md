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

## Files to Modify

| File | Changes |
|------|---------|
| `shared/types/events.ts` | Add Stage 3 event interfaces (new file or extend existing) |
| `shared/types/index.ts` | Export new event types |
| `server/src/prompts/stagePrompts.ts` | Add `buildStage3Prompt()` function |
| `server/src/services/ClaudeResultHandler.ts` | Add `handleStage3Result()` method with retry tracking |
| `server/src/services/EventBroadcaster.ts` | Add `stepStarted()`, `stepCompleted()`, `implementationProgress()` methods |
| `server/src/app.ts` | Add `spawnStage3Implementation()`, `handleStage3Completion()`, wire up auto-start, Stage 3 transition, blocker resume |
| `client/src/stores/sessionStore.ts` | Add `updateStepStatus()`, `setImplementationProgress()` actions |
| `client/src/pages/SessionView.tsx` | Add socket handlers for Stage 3 events, add blocked status UI |

## Testing Strategy (Deferred)
- Unit test `buildStage3Prompt()` generates correct marker instructions
- Unit test `handleStage3Result()` correctly updates step statuses and tracks retries
- Integration test: Create session → answer questions → approve plan → verify Stage 3 auto-starts
- Integration test: Simulate blocker → answer → verify resume
- E2E test: Full flow through Stage 3 with actual file modifications
