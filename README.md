# Ralph Web Dashboard

A modern web interface for managing Ralph autonomous development loops. Monitor, control, and manage your AI-powered development sessions from the browser.

> **Note**: This document describes the planned architecture for the web dashboard. The current implementation is the bash-based [Ralph for Claude Code](./ralph-claude-code/) CLI tool.

## Overview

Ralph Web Dashboard wraps around the existing Ralph CLI tool, providing a real-time web interface without modifying the core Ralph scripts. The server reads Ralph's state files and log outputs via file polling to provide live updates.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              BROWSER                                         │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                     React + TypeScript Frontend                        │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │  │
│  │  │  Dashboard  │  │   Projects  │  │   History   │  │  Settings   │   │  │
│  │  │    View     │  │   Manager   │  │   Browser   │  │    Panel    │   │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘   │  │
│  │                            │                                           │  │
│  │              ┌─────────────┴─────────────┐                            │  │
│  │              │     WebSocket Client      │                            │  │
│  │              │   (Real-time Updates)     │                            │  │
│  │              └───────────────────────────┘                            │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ HTTP/WebSocket
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         NODE.JS + EXPRESS SERVER                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                           API Layer                                    │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │  │
│  │  │  /api/loops │  │/api/projects│  │ /api/history│  │ /api/github │   │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘   │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                        Service Layer                                   │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │  │
│  │  │    Loop     │  │   Project   │  │  Notifier   │  │   GitHub    │   │  │
│  │  │   Manager   │  │   Service   │  │   Service   │  │   Service   │   │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘   │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  WebSocket Server  │  Process Manager  │  File Watcher  │  SQLite DB  │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                      ┌───────────────┼───────────────┐
                      │               │               │
                      ▼               ▼               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            LOCAL FILESYSTEM                                  │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                         Ralph Scripts                                │    │
│  │  ralph_loop.sh      Main autonomous loop engine (1000+ lines)       │    │
│  │  ralph_monitor.sh   Terminal-based live dashboard                   │    │
│  │  ralph_import.sh    PRD to Ralph format converter                   │    │
│  │  setup.sh           Project initialization                          │    │
│  │  create_files.sh    System bootstrap                                │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                      Library Modules (lib/)                          │    │
│  │  circuit_breaker.sh    Three-state pattern (CLOSED/HALF_OPEN/OPEN)  │    │
│  │  response_analyzer.sh  JSON parsing & completion detection          │    │
│  │  date_utils.sh         Cross-platform date utilities                │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                         State Files                                  │    │
│  │  status.json               Loop status, API calls, timestamps       │    │
│  │  progress.json             Real-time execution progress             │    │
│  │  .exit_signals             Completion indicators tracking           │    │
│  │  .circuit_breaker_state    Current breaker state & history          │    │
│  │  .circuit_breaker_history  State transition log                     │    │
│  │  .claude_session_id        Session continuity for Claude CLI        │    │
│  │  .call_count               API calls this hour                      │    │
│  │  .last_reset               Hourly rate limit reset timestamp        │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                         Project Files                                │    │
│  │  PROMPT.md                 Ralph development instructions           │    │
│  │  @fix_plan.md              Prioritized task checklist               │    │
│  │  @AGENT.md                 Build and run instructions               │    │
│  │  logs/ralph.log            Main execution log                       │    │
│  │  logs/claude_output_*.log  Per-iteration Claude output              │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Data Flow

### Important: File-Based Architecture

Ralph writes all output to files, not stdout. The web server must use **file polling** or **file watching** to capture updates:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    RALPH OUTPUT ARCHITECTURE                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Ralph does NOT stream to stdout. Instead:                                   │
│                                                                              │
│  ┌─────────────┐     ┌──────────────────────────────────────────────────┐   │
│  │             │     │  timeout 900s claude-code \                      │   │
│  │   Ralph     │────>│    --output-format json \                        │   │
│  │   Loop      │     │    > logs/claude_output_${loop}.log 2>&1         │   │
│  │             │     └──────────────────────────────────────────────────┘   │
│  └─────────────┘                        │                                    │
│                                         ▼                                    │
│                          ┌──────────────────────────┐                       │
│                          │   Output written to      │                       │
│                          │   log file on disk       │                       │
│                          └──────────────────────────┘                       │
│                                                                              │
│  The server must:                                                            │
│  1. Poll/watch log files for new content                                    │
│  2. Track file position to send only new data                               │
│  3. Parse JSON or text output format                                        │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Starting a Loop

```
┌──────────┐      ┌──────────┐      ┌──────────┐      ┌──────────┐
│  User    │      │  React   │      │  Express │      │  Ralph   │
│  Browser │      │  Client  │      │  Server  │      │  CLI     │
└────┬─────┘      └────┬─────┘      └────┬─────┘      └────┬─────┘
     │                 │                 │                 │
     │  Click Start    │                 │                 │
     │────────────────>│                 │                 │
     │                 │                 │                 │
     │                 │  POST /api/loops/start            │
     │                 │────────────────>│                 │
     │                 │                 │                 │
     │                 │                 │  spawn ralph_loop.sh
     │                 │                 │────────────────>│
     │                 │                 │                 │
     │                 │                 │  (single long-running process)
     │                 │                 │                 │
     │                 │  { loopId, pid, status }         │
     │                 │<────────────────│                 │
     │                 │                 │                 │
     │  UI Update      │                 │  Start file watchers
     │<────────────────│                 │  ─────────────────
     │                 │                 │                 │
```

### Real-time Updates via File Polling

```
┌──────────────────────────────────────────────────────────────────┐
│                   FILE-BASED UPDATE FLOW                          │
└──────────────────────────────────────────────────────────────────┘

  Ralph Process           File System              Server              Browser
       │                      │                      │                    │
       │  Write to            │                      │                    │
       │  status.json         │                      │                    │
       │─────────────────────>│                      │                    │
       │                      │                      │                    │
       │                      │  File change         │                    │
       │                      │  detected (poll)     │                    │
       │                      │─────────────────────>│                    │
       │                      │                      │                    │
       │                      │                      │  Parse JSON        │
       │                      │                      │  ───────────       │
       │                      │                      │                    │
       │                      │                      │  WebSocket:        │
       │                      │                      │  status.update     │
       │                      │                      │═══════════════════>│
       │                      │                      │                    │
       │  Write to            │                      │                    │
       │  progress.json       │                      │                    │
       │─────────────────────>│                      │                    │
       │  (every 10 sec)      │                      │                    │
       │                      │                      │                    │
       │                      │  File change         │                    │
       │                      │─────────────────────>│                    │
       │                      │                      │                    │
       │                      │                      │  WebSocket:        │
       │                      │                      │  loop.progress     │
       │                      │                      │═══════════════════>│
       │                      │                      │                    │
       │  Append to           │                      │                    │
       │  claude_output.log   │                      │                    │
       │─────────────────────>│                      │                    │
       │                      │                      │                    │
       │                      │  Tail new lines      │                    │
       │                      │─────────────────────>│                    │
       │                      │                      │                    │
       │                      │                      │  WebSocket:        │
       │                      │                      │  log.chunk         │
       │                      │                      │═══════════════════>│
       │                      │                      │                    │
```

## Component Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           FRONTEND COMPONENTS                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                            App Shell                                 │    │
│  │  ┌──────────┐  ┌─────────────────────────────────────────────────┐  │    │
│  │  │  Sidebar │  │                   Main Content                   │  │    │
│  │  │          │  │  ┌───────────────────────────────────────────┐  │  │    │
│  │  │ Dashboard│  │  │              Dashboard Page                │  │    │
│  │  │ Projects │  │  │  ┌─────────────┐  ┌─────────────────────┐  │  │    │
│  │  │ History  │  │  │  │ Active Loop │  │   System Metrics    │  │  │    │
│  │  │ Settings │  │  │  │    Card     │  │       Card          │  │  │    │
│  │  │          │  │  │  └─────────────┘  └─────────────────────┘  │  │    │
│  │  │          │  │  │  ┌─────────────────────────────────────┐   │  │    │
│  │  │          │  │  │  │         Live Terminal View          │   │  │    │
│  │  │          │  │  │  │   (File-polled log stream)          │   │  │    │
│  │  │          │  │  │  └─────────────────────────────────────┘   │  │    │
│  │  │          │  │  │  ┌─────────────┐  ┌─────────────────────┐  │  │    │
│  │  │          │  │  │  │Circuit Brkr │  │   Rate Limiter      │  │  │    │
│  │  │          │  │  │  │   Status    │  │      Status         │  │  │    │
│  │  │          │  │  │  └─────────────┘  └─────────────────────┘  │  │    │
│  │  └──────────┘  │  └───────────────────────────────────────────┘  │  │    │
│  │                └─────────────────────────────────────────────────┘  │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Backend Services

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           BACKEND SERVICES                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────┐    ┌─────────────────────┐                         │
│  │    LoopManager      │    │   ProjectService    │                         │
│  ├─────────────────────┤    ├─────────────────────┤                         │
│  │ • start(projectId)  │    │ • create(config)    │                         │
│  │ • stop(loopId)      │    │ • list()            │                         │
│  │ • getStatus(loopId) │    │ • get(id)           │                         │
│  │ • getLogs(loopId)   │    │ • update(id, data)  │                         │
│  │ • listActive()      │    │ • delete(id)        │                         │
│  │                     │    │ • importPRD(file)   │                         │
│  └──────────┬──────────┘    └──────────┬──────────┘                         │
│             │                          │                                     │
│             └──────────┬───────────────┘                                     │
│                        ▼                                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                      ProcessManager                                  │    │
│  ├─────────────────────────────────────────────────────────────────────┤    │
│  │  • spawn(command, args)     - Start Ralph as single long-lived proc │    │
│  │  • kill(pid)                - Terminate process (SIGTERM)           │    │
│  │  • isAlive(pid)             - Check if process running              │    │
│  │  • onExit(pid, callback)    - Handle process exit                   │    │
│  │                                                                      │    │
│  │  Note: Ralph is ONE long-running process per project.               │    │
│  │  Cannot run multiple Ralph instances in same project directory.     │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌─────────────────────┐    ┌─────────────────────┐                         │
│  │   FileWatcher       │    │   NotifierService   │                         │
│  ├─────────────────────┤    ├─────────────────────┤                         │
│  │ • watch(path)       │    │ • send(title, body) │                         │
│  │ • poll(interval)    │───>│ • onLoopComplete()  │                         │
│  │ • tailLog(path, cb) │    │ • onCircuitOpen()   │                         │
│  │ • unwatch(path)     │    │ • onError()         │                         │
│  └─────────────────────┘    └─────────────────────┘                         │
│                                                                              │
│  ┌─────────────────────┐    ┌─────────────────────┐                         │
│  │   GitHubService     │    │   HistoryService    │                         │
│  ├─────────────────────┤    ├─────────────────────┤                         │
│  │ • linkRepo(url)     │    │ • record(loopData)  │                         │
│  │ • getCommits()      │    │ • query(filters)    │                         │
│  │ • getPRs()          │    │ • getStats()        │                         │
│  │ • getStatus()       │    │ • export(format)    │                         │
│  └─────────────────────┘    └─────────────────────┘                         │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Database Schema

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SQLite Database                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────┐         ┌─────────────────────┐                    │
│  │      projects       │         │       loops         │                    │
│  ├─────────────────────┤         ├─────────────────────┤                    │
│  │ id (PK)             │────────<│ id (PK)             │                    │
│  │ name                │         │ project_id (FK)     │                    │
│  │ path                │         │ pid                 │                    │
│  │ description         │         │ status              │                    │
│  │ github_repo         │         │ started_at          │                    │
│  │ github_token_enc    │         │ ended_at            │                    │
│  │ max_calls_per_hour  │         │ exit_reason         │                    │
│  │ created_at          │         │ loop_count          │                    │
│  │ updated_at          │         │ api_calls           │                    │
│  │ config (JSON)       │         │ files_changed       │                    │
│  └─────────────────────┘         │ error_count         │                    │
│                                  │ logs_path           │                    │
│                                  └─────────────────────┘                    │
│                                            │                                 │
│  ┌─────────────────────┐         ┌────────┴────────────┐                    │
│  │     settings        │         │    loop_events      │                    │
│  ├─────────────────────┤         ├─────────────────────┤                    │
│  │ key (PK)            │         │ id (PK)             │                    │
│  │ value               │         │ loop_id (FK)        │                    │
│  │ updated_at          │         │ event_type          │                    │
│  └─────────────────────┘         │ payload (JSON)      │                    │
│                                  │ timestamp           │                    │
│  ┌─────────────────────┐         └─────────────────────┘                    │
│  │   notifications     │                                                     │
│  ├─────────────────────┤         ┌─────────────────────┐                    │
│  │ id (PK)             │         │   circuit_breaker   │                    │
│  │ loop_id (FK)        │         │      _snapshots     │                    │
│  │ type                │         ├─────────────────────┤                    │
│  │ title               │         │ id (PK)             │                    │
│  │ message             │         │ loop_id (FK)        │                    │
│  │ read                │         │ state               │                    │
│  │ created_at          │         │ consecutive_no_prog │                    │
│  └─────────────────────┘         │ reason              │                    │
│                                  │ timestamp           │                    │
│                                  └─────────────────────┘                    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## WebSocket Events

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         WebSocket Protocol                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Server → Client Events                                                      │
│  ─────────────────────                                                       │
│                                                                              │
│  LOOP LIFECYCLE                                                              │
│  ┌─────────────────┬────────────────────────────────────────────────────┐   │
│  │ Event           │ Payload                                            │   │
│  ├─────────────────┼────────────────────────────────────────────────────┤   │
│  │ loop.started    │ { loopId, projectId, pid, timestamp }              │   │
│  │ loop.progress   │ { loopId, iteration, apiCalls, elapsed, status }   │   │
│  │ loop.log        │ { loopId, chunk, timestamp }                       │   │
│  │ loop.completed  │ { loopId, exitReason, duration, stats }            │   │
│  │ loop.error      │ { loopId, error, code, recoverable }               │   │
│  │ loop.timeout    │ { loopId, timeoutMinutes }                         │   │
│  │ loop.retrying   │ { loopId, attempt, nextRetrySeconds }              │   │
│  └─────────────────┴────────────────────────────────────────────────────┘   │
│                                                                              │
│  CIRCUIT BREAKER                                                             │
│  ┌─────────────────┬────────────────────────────────────────────────────┐   │
│  │ Event           │ Payload                                            │   │
│  ├─────────────────┼────────────────────────────────────────────────────┤   │
│  │ circuit.closed  │ { loopId, recoveredFrom }                          │   │
│  │ circuit.half    │ { loopId, consecutiveNoProgress, monitoring }      │   │
│  │ circuit.open    │ { loopId, reason, loopsSinceProgress }             │   │
│  └─────────────────┴────────────────────────────────────────────────────┘   │
│                                                                              │
│  EXIT CONDITIONS                                                             │
│  ┌─────────────────┬────────────────────────────────────────────────────┐   │
│  │ Event           │ Payload                                            │   │
│  ├─────────────────┼────────────────────────────────────────────────────┤   │
│  │ exit.detected   │ { loopId, type, confidence, loopsUntilExit }       │   │
│  │ exit.imminent   │ { loopId, reason, estimatedLoops }                 │   │
│  │ exit.types:     │ test_saturation, completion_signals,               │   │
│  │                 │ project_complete, plan_complete, stagnation        │   │
│  └─────────────────┴────────────────────────────────────────────────────┘   │
│                                                                              │
│  RATE LIMITING                                                               │
│  ┌─────────────────┬────────────────────────────────────────────────────┐   │
│  │ Event           │ Payload                                            │   │
│  ├─────────────────┼────────────────────────────────────────────────────┤   │
│  │ rate.update     │ { loopId, callsUsed, callsRemaining, resetAt }     │   │
│  │ rate.warning    │ { loopId, callsRemaining, percentUsed }            │   │
│  │ rate.limited    │ { loopId, minutesUntilReset }                      │   │
│  │ rate.reset      │ { loopId, newLimit }                               │   │
│  │ rate.api_limit  │ { loopId, waitMinutes } (Claude 5-hour limit)      │   │
│  └─────────────────┴────────────────────────────────────────────────────┘   │
│                                                                              │
│  SESSION & FILES                                                             │
│  ┌─────────────────┬────────────────────────────────────────────────────┐   │
│  │ Event           │ Payload                                            │   │
│  ├─────────────────┼────────────────────────────────────────────────────┤   │
│  │ session.started │ { loopId, sessionId, mode: 'new'|'resume' }        │   │
│  │ session.saved   │ { loopId, sessionId }                              │   │
│  │ files.changed   │ { loopId, count, files: [...] }                    │   │
│  └─────────────────┴────────────────────────────────────────────────────┘   │
│                                                                              │
│  NOTIFICATIONS                                                               │
│  ┌─────────────────┬────────────────────────────────────────────────────┐   │
│  │ Event           │ Payload                                            │   │
│  ├─────────────────┼────────────────────────────────────────────────────┤   │
│  │ notification    │ { type, title, message, loopId?, actions? }        │   │
│  └─────────────────┴────────────────────────────────────────────────────┘   │
│                                                                              │
│  Client → Server Events                                                      │
│  ─────────────────────                                                       │
│                                                                              │
│  ┌─────────────────┬────────────────────────────────────────────────────┐   │
│  │ Event           │ Payload                                            │   │
│  ├─────────────────┼────────────────────────────────────────────────────┤   │
│  │ subscribe       │ { loopId }  - Subscribe to loop updates            │   │
│  │ unsubscribe     │ { loopId }  - Unsubscribe from loop                │   │
│  │ ping            │ { }         - Keep-alive                           │   │
│  └─────────────────┴────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Ralph State File Formats

These are the actual JSON structures Ralph produces:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         RALPH STATE FILES                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  status.json (updated after each loop event)                                │
│  ───────────────────────────────────────────                                │
│  {                                                                          │
│    "timestamp": "2026-01-10T12:34:56Z",                                     │
│    "loop_count": 5,                                                         │
│    "calls_made_this_hour": 25,                                              │
│    "max_calls_per_hour": 100,                                               │
│    "last_action": "executing claude code",                                  │
│    "status": "running|success|error|halted|paused|stopped|completed",       │
│    "exit_reason": "test_saturation|completion_signals|...",                 │
│    "next_reset": "2026-01-10T13:00:00Z"                                     │
│  }                                                                          │
│                                                                              │
│  progress.json (updated every 10 seconds during Claude execution)           │
│  ────────────────────────────────────────────────────────────────           │
│  {                                                                          │
│    "status": "executing|completed|failed",                                  │
│    "indicator": "⠋",                                                        │
│    "elapsed_seconds": 45,                                                   │
│    "last_output": "Working on feature...",                                  │
│    "timestamp": "2026-01-10T12:35:41Z"                                      │
│  }                                                                          │
│                                                                              │
│  .exit_signals (tracks completion indicators)                               │
│  ────────────────────────────────────────────                               │
│  {                                                                          │
│    "test_only_loops": [1, 2],                                               │
│    "done_signals": [5],                                                     │
│    "completion_indicators": [3, 5]                                          │
│  }                                                                          │
│                                                                              │
│  .circuit_breaker_state (three-state pattern)                               │
│  ────────────────────────────────────────────                               │
│  {                                                                          │
│    "state": "CLOSED|HALF_OPEN|OPEN",                                        │
│    "last_change": "2026-01-10T12:00:00Z",                                   │
│    "consecutive_no_progress": 0,                                            │
│    "consecutive_same_error": 0,                                             │
│    "last_progress_loop": 5,                                                 │
│    "total_opens": 1,                                                        │
│    "reason": "stagnation_detected",                                         │
│    "current_loop": 6                                                        │
│  }                                                                          │
│                                                                              │
│  .claude_session_id (session continuity)                                    │
│  ───────────────────────────────────────                                    │
│  {                                                                          │
│    "session_id": "claude-session-abc123",                                   │
│    "timestamp": 1704902400,                                                 │
│    "expires_at": 1705075200                                                 │
│  }                                                                          │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Security Considerations

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SECURITY ARCHITECTURE                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  LOCAL-ONLY DEPLOYMENT (Solo Developer)                                      │
│  ──────────────────────────────────────                                      │
│  • Server binds to localhost only (127.0.0.1)                               │
│  • No authentication required for local-only access                         │
│  • CORS restricted to localhost origins                                     │
│                                                                              │
│  DATA PROTECTION                                                             │
│  ───────────────                                                             │
│  • GitHub tokens encrypted at rest (github_token_enc field)                 │
│  • Logs may contain sensitive data - not exposed via API without filtering │
│  • Session IDs treated as sensitive                                         │
│                                                                              │
│  INPUT VALIDATION                                                            │
│  ────────────────                                                            │
│  • All API inputs validated before processing                               │
│  • Path traversal prevention for project paths                              │
│  • Command injection prevention (no shell interpolation)                    │
│                                                                              │
│  PROCESS ISOLATION                                                           │
│  ─────────────────                                                           │
│  • Ralph runs in project directory only                                     │
│  • Server cannot execute arbitrary commands                                 │
│  • Only predefined Ralph scripts can be invoked                             │
│                                                                              │
│  FUTURE: Multi-User Deployment                                               │
│  ─────────────────────────────                                               │
│  • Add JWT or session-based authentication                                  │
│  • Implement RBAC for project access                                        │
│  • Add audit logging                                                        │
│  • Enable HTTPS with proper certificates                                    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, TypeScript, Tailwind CSS |
| State | Zustand |
| Backend | Node.js, Express |
| Real-time | Socket.IO (WebSocket) |
| Database | SQLite (better-sqlite3) |
| File Watching | chokidar |
| Process | Node child_process |
| Notifications | node-notifier |

## Features

### Dashboard
- Real-time loop status and metrics
- Live terminal output with ANSI color support
- Circuit breaker state visualization (CLOSED/HALF_OPEN/OPEN)
- Rate limit countdown timer
- Exit condition detection display

### Project Management
- Create new Ralph projects
- Import PRDs and specifications
- Configure loop settings per project
- Link GitHub repositories

### History
- Browse past loop executions
- Filter by project, status, date
- View detailed loop statistics
- Export history data

### Notifications
- Desktop notifications on loop completion
- Browser notifications (with permission)
- Circuit breaker alerts
- Configurable notification preferences

### GitHub Integration
- Link projects to repositories
- View recent commits
- Monitor PR status
- Quick links to repo

## Getting Started

```bash
# Install dependencies
npm install

# Start development server (runs both client and server)
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

## Project Structure

```
ralph-web/
├── client/                 # React frontend
│   ├── src/
│   │   ├── components/     # UI components
│   │   ├── pages/          # Page components
│   │   ├── hooks/          # Custom React hooks
│   │   │   ├── useWebSocket.ts
│   │   │   ├── useLoopStatus.ts
│   │   │   └── useFilePolling.ts
│   │   ├── services/       # API clients
│   │   ├── store/          # Zustand stores
│   │   └── types/          # TypeScript types
│   └── public/
├── server/                 # Express backend
│   ├── src/
│   │   ├── routes/         # API routes
│   │   ├── services/       # Business logic
│   │   │   ├── LoopManager.ts
│   │   │   ├── FileWatcher.ts
│   │   │   └── ProcessManager.ts
│   │   ├── models/         # Database models
│   │   ├── websocket/      # WebSocket handlers
│   │   └── utils/          # Utilities
│   └── db/                 # SQLite database
├── shared/                 # Shared types
│   └── types/
│       ├── events.ts       # WebSocket event types
│       └── models.ts       # Shared data models
├── ralph-claude-code/      # Ralph CLI (upstream)
└── package.json
```

## Implementation Notes

### File Polling Strategy

Ralph writes to files, not stdout. The server uses this approach:

1. **State Files** (status.json, progress.json, etc.)
   - Poll every 1-2 seconds
   - Compare timestamps to detect changes
   - Parse and broadcast via WebSocket

2. **Log Files** (logs/claude_output_*.log)
   - Track file position (bytes read)
   - Tail new content on each poll
   - Stream chunks to subscribed clients

3. **Performance**
   - Use chokidar for efficient file watching where supported
   - Fall back to polling on unsupported filesystems
   - Debounce rapid file changes

### Process Lifecycle

Ralph is a single long-running bash process:

```
Server                          Ralph Process
   │                                  │
   │  spawn("ralph_loop.sh")          │
   │─────────────────────────────────>│
   │                                  │
   │  (process runs indefinitely)     │
   │                                  │
   │  kill(pid, SIGTERM)              │
   │─────────────────────────────────>│
   │                                  │
   │  (graceful shutdown)             │
   │<─────────────────────────────────│
   │                                  │
```

## License

MIT
