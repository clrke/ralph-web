# Claude Code Web Interface

A modern web interface for interactive Claude Code development workflows. Features human-in-the-loop plan review, structured clarifying questions, and visual plan editing.

> **Note**: This document describes the planned architecture. The design supports interactive, quality-driven development workflows with human checkpoints.

## Overview

This web app provides a guided interface for Claude Code that supports:
- **Interactive workflows** with clarifying questions at each stage
- **Visual plan editing** with tree/kanban views
- **Iterative review cycles** (recommended 10x) with sign-off approval
- **PR creation and review** integrated into the workflow

## Workflow Architecture

```mermaid
flowchart TB
    subgraph Stage1["Stage 1: Feature Discovery"]
        A["User describes feature"] --> B["Subagents study codebase"]
        B --> C["Present clarifying questions<br/>(structured forms)"]
        C --> D["User answers"]
        D --> E{"More questions?"}
        E -->|Yes| C
        E -->|No| F["Generate initial plan"]
    end

    subgraph Stage2["Stage 2: Plan Review (10x recommended)"]
        F --> G["Display plan in visual editor"]
        G --> H["Subagents review for shortcuts"]
        H --> I["Present findings as forms"]
        I --> J["User reviews & answers"]
        J --> K{"Approve iteration?"}
        K -->|No, needs work| L["Refine plan"]
        L --> G
        K -->|Yes| M{"Review count"}
        M -->|"< 10x"| N["Warning: Recommend more review"]
        M -->|">= 10x"| O["Ready for implementation"]
        N --> P{"User sign-off?"}
        P -->|Continue reviewing| G
        P -->|Proceed anyway| O
    end

    subgraph Stage3["Stage 3: Implementation"]
        O --> Q["Execute plan step"]
        Q --> R{"Unknowns encountered?"}
        R -->|Yes| S["Pause execution"]
        S --> T["Enter plan mode"]
        T --> U["Present questions"]
        U --> V["User answers"]
        V --> W["Update plan"]
        W --> Q
        R -->|No| X{"More steps?"}
        X -->|Yes| Q
        X -->|No| Y["Implementation complete"]
    end

    subgraph Stage4["Stage 4: PR Creation"]
        Y --> Z["Generate PR"]
        Z --> AA["Display PR details"]
        AA --> AB["Record PR number"]
    end

    subgraph Stage5["Stage 5: PR Review"]
        AB --> AC["Subagents review PR"]
        AC --> AD{"Issues found?"}
        AD -->|Yes, even minor| AE["Enter plan mode"]
        AE --> AF["Present issues as questions"]
        AF --> AG["User decides action"]
        AG --> AH["Apply fixes"]
        AH --> AC
        AD -->|No| AI["PR approved"]
    end

    style Stage1 fill:#e3f2fd
    style Stage2 fill:#fff3e0
    style Stage3 fill:#e8f5e9
    style Stage4 fill:#f3e5f5
    style Stage5 fill:#fce4ec
```

## System Architecture

```mermaid
flowchart TB
    subgraph Browser["Browser"]
        subgraph Frontend["React + TypeScript Frontend"]
            Chat["Conversation View"]
            Forms["Structured Question Forms"]
            PlanEditor["Visual Plan Editor"]
            Terminal["Live Terminal Output"]
            PRView["PR Review Panel"]
        end
    end

    subgraph Server["Node.js + Express Server"]
        subgraph API["API Layer"]
            SessionAPI["/api/sessions"]
            PlanAPI["/api/plans"]
            QuestionsAPI["/api/questions"]
            PRAPI["/api/pull-requests"]
        end
        subgraph Services["Service Layer"]
            SessionMgr["Session Manager"]
            PlanService["Plan Service"]
            QuestionService["Question Service"]
            PRService["PR Service"]
            ReviewService["Review Counter"]
        end
        subgraph Core["Core"]
            ClaudeOrchestrator["Claude Code Orchestrator"]
            WSServer["WebSocket Server"]
            SQLite["SQLite DB"]
        end
    end

    subgraph ClaudeCode["Claude Code CLI"]
        CC["claude-code process"]
        PlanMode["--plan mode"]
        Subagents["Subagent execution"]
    end

    Frontend <-->|HTTP/WebSocket| Server
    ClaudeOrchestrator -->|"spawn with flags"| ClaudeCode
    ClaudeOrchestrator -->|"parse output"| CC
```

## Component Details

### Visual Plan Editor

```mermaid
flowchart TB
    subgraph PlanEditor["Visual Plan Editor"]
        subgraph Views["View Modes"]
            Tree["Tree View<br/>(hierarchical steps)"]
            Kanban["Kanban View<br/>(by status)"]
            Timeline["Timeline View<br/>(sequence)"]
        end

        subgraph Actions["Plan Actions"]
            Drag["Drag to reorder"]
            Edit["Inline editing"]
            Add["Add step"]
            Delete["Remove step"]
            Expand["Expand/collapse"]
        end

        subgraph Status["Step Status"]
            Pending["⏳ Pending"]
            InProgress["🔄 In Progress"]
            NeedsReview["⚠️ Needs Review"]
            Approved["✅ Approved"]
            Blocked["🚫 Blocked"]
        end
    end
```

### Structured Question Forms

```mermaid
flowchart LR
    subgraph QuestionTypes["Question Types"]
        SingleChoice["Single Choice<br/>(radio buttons)"]
        MultiChoice["Multi Choice<br/>(checkboxes)"]
        TextInput["Text Input<br/>(short/long)"]
        FileSelect["File Selector<br/>(from codebase)"]
        CodeSnippet["Code Snippet<br/>(with syntax highlight)"]
        Confirmation["Yes/No<br/>(with context)"]
    end

    subgraph Presentation["Presentation"]
        Grouped["Grouped by topic"]
        Priority["Ordered by priority"]
        Required["Required vs optional"]
        Defaults["Smart defaults"]
    end
```

### Review Iteration Tracker

```mermaid
flowchart TB
    subgraph ReviewTracker["Review Iteration Tracker"]
        Counter["Current: 3/10 reviews"]
        Progress["Progress bar"]

        subgraph Findings["Findings per iteration"]
            I1["Iteration 1: 5 issues"]
            I2["Iteration 2: 3 issues"]
            I3["Iteration 3: 1 issue"]
        end

        subgraph SignOff["Sign-off Gate"]
            Warning["⚠️ Only 3 reviews completed<br/>Recommend at least 10"]
            Checkbox["☐ I understand the risks<br/>and approve with fewer reviews"]
            Proceed["Proceed to Implementation"]
        end
    end

    Counter --> Progress
    Progress --> Findings
    Findings --> SignOff
```

## Database Schema

```mermaid
erDiagram
    sessions ||--o{ plans : has
    sessions ||--o{ questions : contains
    sessions ||--o{ review_iterations : tracks
    plans ||--o{ plan_steps : contains
    plans ||--o{ pull_requests : generates
    pull_requests ||--o{ pr_reviews : undergoes

    sessions {
        int id PK
        string feature_description
        string status
        int current_stage
        datetime created_at
        datetime updated_at
    }

    plans {
        int id PK
        int session_id FK
        int version
        json plan_data
        boolean is_approved
        int review_count
        datetime created_at
    }

    plan_steps {
        int id PK
        int plan_id FK
        int parent_id FK
        int order_index
        string title
        string description
        string status
        json metadata
    }

    questions {
        int id PK
        int session_id FK
        string stage
        string question_type
        string question_text
        json options
        json answer
        boolean is_required
        datetime asked_at
        datetime answered_at
    }

    review_iterations {
        int id PK
        int plan_id FK
        int iteration_number
        json findings
        boolean user_approved
        datetime completed_at
    }

    pull_requests {
        int id PK
        int plan_id FK
        string pr_number
        string pr_url
        string status
        datetime created_at
    }

    pr_reviews {
        int id PK
        int pr_id FK
        json issues_found
        boolean all_resolved
        datetime reviewed_at
    }
```

## WebSocket Events

### Workflow Events

```mermaid
flowchart LR
    subgraph StageEvents["Stage Transitions"]
        A["stage.discovery"]
        B["stage.planning"]
        C["stage.review"]
        D["stage.implementation"]
        E["stage.pr_creation"]
        F["stage.pr_review"]
    end

    subgraph QuestionEvents["Questions"]
        G["question.asked"]
        H["question.answered"]
        I["questions.batch"]
    end

    subgraph PlanEvents["Plan Updates"]
        J["plan.created"]
        K["plan.step_added"]
        L["plan.step_updated"]
        M["plan.step_reordered"]
        N["plan.approved"]
    end

    subgraph ReviewEvents["Review Cycle"]
        O["review.started"]
        P["review.findings"]
        Q["review.iteration_complete"]
        R["review.signoff_required"]
        S["review.approved"]
    end

    subgraph ExecutionEvents["Execution"]
        T["execution.step_started"]
        U["execution.step_completed"]
        V["execution.paused_unknown"]
        W["execution.resumed"]
    end

    subgraph PREvents["Pull Request"]
        X["pr.created"]
        Y["pr.review_started"]
        Z["pr.issue_found"]
        AA["pr.approved"]
    end
```

### Event Payloads

| Event | Payload |
|-------|---------|
| `stage.discovery` | `{ sessionId, featureDescription }` |
| `question.asked` | `{ sessionId, questionId, type, text, options, required }` |
| `question.answered` | `{ sessionId, questionId, answer }` |
| `plan.created` | `{ sessionId, planId, steps[], version }` |
| `plan.step_updated` | `{ planId, stepId, changes, updatedBy }` |
| `review.started` | `{ planId, iterationNumber }` |
| `review.findings` | `{ planId, iteration, issues[], shortcuts[] }` |
| `review.signoff_required` | `{ planId, reviewCount, recommendedMin: 10 }` |
| `execution.paused_unknown` | `{ sessionId, stepId, unknowns[], needsInput: true }` |
| `pr.created` | `{ sessionId, prNumber, prUrl, title }` |
| `pr.issue_found` | `{ prId, issue, severity, suggestion }` |

## Claude Code Integration

### Direct Process Control

```mermaid
sequenceDiagram
    participant UI as Web UI
    participant Server as Express Server
    participant Orch as Claude Orchestrator
    participant CC as Claude Code CLI

    UI->>Server: Start session with feature
    Server->>Orch: createSession(feature)
    Orch->>CC: spawn claude-code --plan
    CC-->>Orch: Streaming output
    Orch-->>Server: Parse questions/plan
    Server-->>UI: WebSocket: question.asked

    UI->>Server: Answer question
    Server->>Orch: sendInput(answer)
    Orch->>CC: stdin write
    CC-->>Orch: Next output
    Orch-->>Server: Parse response
    Server-->>UI: WebSocket: plan.created

    Note over UI,CC: Review iterations
    loop 10x Review
        UI->>Server: Request review
        Server->>Orch: runReview()
        Orch->>CC: spawn with review prompt
        CC-->>Orch: Findings
        Orch-->>Server: Parse findings
        Server-->>UI: WebSocket: review.findings
    end

    UI->>Server: Approve plan (with signoff)
    Server->>Orch: startImplementation()
    Orch->>CC: spawn implementation

    alt Unknown encountered
        CC-->>Orch: Pause signal
        Orch-->>Server: Parse unknowns
        Server-->>UI: WebSocket: execution.paused_unknown
        UI->>Server: Provide input
        Server->>Orch: resumeWithInput()
    end

    CC-->>Orch: Implementation complete
    Orch->>CC: spawn gh pr create
    CC-->>Orch: PR URL
    Server-->>UI: WebSocket: pr.created
```

### CLI Flags Used

| Flag | Purpose |
|------|---------|
| `--plan` | Enter plan mode for exploration |
| `--continue` | Resume session context |
| `--output-format json` | Structured output parsing |
| `--allowed-tools` | Control available tools per stage |
| `-p` | Pass prompts programmatically |

## UI Components

### Session View

```mermaid
flowchart TB
    subgraph SessionView["Main Session View"]
        subgraph Header["Header"]
            Feature["Feature: Add user authentication"]
            Stage["Stage: Plan Review (7/10)"]
            Status["Status: Awaiting input"]
        end

        subgraph MainPanel["Main Panel (split)"]
            subgraph Left["Left: Plan Editor"]
                PlanTree["📁 Authentication System<br/>├── 📄 Design JWT schema<br/>├── 📄 Create auth middleware<br/>├── 📄 Add login endpoint<br/>└── 📄 Add logout endpoint"]
            end
            subgraph Right["Right: Interaction"]
                Questions["Current Questions"]
                Terminal["Claude Output"]
            end
        end

        subgraph Footer["Footer Actions"]
            ReviewBtn["🔄 Run Review (7/10)"]
            ApproveBtn["✅ Approve & Implement"]
            PauseBtn["⏸️ Pause"]
        end
    end
```

### Question Form Component

```mermaid
flowchart TB
    subgraph QuestionForm["Question Form"]
        Q1["Q1: Which authentication method?"]
        Q1Opts["○ JWT tokens (recommended)<br/>○ Session cookies<br/>○ OAuth 2.0<br/>○ Other: ___"]

        Q2["Q2: Where should auth middleware go?"]
        Q2Opts["☑ src/middleware/auth.ts<br/>☐ src/lib/auth.ts<br/>☐ Create new directory"]

        Q3["Q3: Additional requirements?"]
        Q3Text["[Text area for details]"]

        Submit["Submit Answers"]
    end
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, TypeScript, Tailwind CSS |
| State | Zustand |
| Plan Editor | React DnD, React Flow (optional) |
| Backend | Node.js, Express |
| Real-time | Socket.IO |
| Database | SQLite (better-sqlite3) |
| CLI Control | Node child_process, pty.js |
| Notifications | node-notifier |

## Project Structure

```
claude-code-web/
├── client/
│   ├── src/
│   │   ├── components/
│   │   │   ├── PlanEditor/
│   │   │   │   ├── TreeView.tsx
│   │   │   │   ├── KanbanView.tsx
│   │   │   │   ├── StepCard.tsx
│   │   │   │   └── DragHandle.tsx
│   │   │   ├── QuestionForms/
│   │   │   │   ├── QuestionForm.tsx
│   │   │   │   ├── SingleChoice.tsx
│   │   │   │   ├── MultiChoice.tsx
│   │   │   │   ├── TextInput.tsx
│   │   │   │   └── FileSelector.tsx
│   │   │   ├── ReviewTracker/
│   │   │   │   ├── IterationCounter.tsx
│   │   │   │   ├── FindingsList.tsx
│   │   │   │   └── SignOffGate.tsx
│   │   │   ├── Terminal/
│   │   │   │   └── LiveOutput.tsx
│   │   │   └── PRView/
│   │   │       ├── PRDetails.tsx
│   │   │       └── IssuesList.tsx
│   │   ├── pages/
│   │   │   ├── NewSession.tsx
│   │   │   ├── SessionView.tsx
│   │   │   └── PRReview.tsx
│   │   ├── hooks/
│   │   │   ├── useSession.ts
│   │   │   ├── usePlan.ts
│   │   │   ├── useQuestions.ts
│   │   │   └── useReviewCycle.ts
│   │   ├── store/
│   │   │   ├── sessionStore.ts
│   │   │   └── planStore.ts
│   │   └── types/
│   │       ├── session.ts
│   │       ├── plan.ts
│   │       └── questions.ts
│   └── public/
├── server/
│   ├── src/
│   │   ├── routes/
│   │   │   ├── sessions.ts
│   │   │   ├── plans.ts
│   │   │   ├── questions.ts
│   │   │   └── pull-requests.ts
│   │   ├── services/
│   │   │   ├── ClaudeOrchestrator.ts
│   │   │   ├── SessionManager.ts
│   │   │   ├── PlanService.ts
│   │   │   ├── QuestionParser.ts
│   │   │   └── ReviewService.ts
│   │   ├── websocket/
│   │   │   └── handlers.ts
│   │   └── utils/
│   │       └── outputParser.ts
│   └── db/
├── shared/
│   └── types/
└── package.json
```

## Getting Started

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

## Key Differences from Original Ralph Design

| Aspect | Original Ralph | New Design |
|--------|---------------|------------|
| Execution model | Autonomous loops | Human-in-the-loop |
| User interaction | Monitor only | Active participation |
| Plan management | Implicit in PROMPT.md | Visual editor |
| Questions | None (autonomous) | Structured forms |
| Quality gates | Circuit breaker | 10x review + sign-off |
| PR workflow | Not included | Full PR creation + review |
| Backend | Ralph bash scripts | Direct Claude Code control |

## License

MIT
