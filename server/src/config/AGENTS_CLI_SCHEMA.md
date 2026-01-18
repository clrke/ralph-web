# Claude CLI --agents Flag Schema Documentation

This document describes the schema and usage of the `--agents` CLI flag for defining custom subagents in Claude Code.

## Overview

The `--agents` CLI flag allows you to define subagents as JSON when launching Claude Code. These subagents exist only for that session and aren't saved to disk, making them useful for automation scripts and programmatic spawning.

**Verified with:** Claude Code CLI v2.1.11

## Flag Syntax

```bash
claude --agents '<json-object>' [other options]
```

The JSON must be a single-line string (or escaped for multi-line). Use single quotes around the JSON to avoid shell interpretation issues.

## JSON Schema

```json
{
  "<agent-name>": {
    "description": "<string>",
    "prompt": "<string>",
    "tools": ["<string>", ...],
    "model": "<string>",
    "permissionMode": "<string>",
    "skills": ["<string>", ...],
    "hooks": { ... }
  }
}
```

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `description` | `string` | Describes when Claude should delegate to this subagent. Claude uses this to decide when to use the subagent. |
| `prompt` | `string` | The system prompt that guides the subagent's behavior. |

### Optional Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `tools` | `string[]` | (inherits all) | List of tools the subagent can use. If omitted, inherits all available tools from the parent conversation. |
| `model` | `string` | `"sonnet"` | Model to use: `"sonnet"`, `"opus"`, `"haiku"`, or `"inherit"`. |
| `permissionMode` | `string` | `"default"` | Permission mode: `"default"`, `"acceptEdits"`, `"dontAsk"`, `"bypassPermissions"`, or `"plan"`. |
| `skills` | `string[]` | `[]` | Skills to load into the subagent's context at startup. |
| `hooks` | `object` | `{}` | Lifecycle hooks scoped to this subagent. |

### Valid Tool Names

Common tools include:
- `Read` - Read files
- `Write` - Write files
- `Edit` - Edit files
- `Bash` - Execute shell commands
- `Grep` - Search file contents
- `Glob` - Find files by pattern
- `Task` - Spawn sub-agents
- `WebFetch` - Fetch web content
- `WebSearch` - Search the web
- `TodoWrite` - Manage todo lists

### Valid Model Values

- `"haiku"` - Fastest, most cost-effective (recommended for exploration/review agents)
- `"sonnet"` - Balanced performance and cost (default)
- `"opus"` - Most capable, highest cost
- `"inherit"` - Use the same model as the parent conversation

## Examples

### Single Agent

```bash
claude --agents '{"code-reviewer": {"description": "Expert code reviewer. Use proactively after code changes.", "prompt": "You are a senior code reviewer. Focus on code quality, security, and best practices.", "tools": ["Read", "Grep", "Glob", "Bash"], "model": "haiku"}}' -p "Review the recent changes"
```

### Multiple Agents

```bash
claude --agents '{"reviewer": {"description": "Code reviewer", "prompt": "Review code quality", "tools": ["Read", "Grep"], "model": "haiku"}, "explorer": {"description": "Codebase explorer", "prompt": "Explore and understand code", "tools": ["Read", "Glob", "Grep"], "model": "haiku"}}' -p "Analyze the project"
```

### Read-Only Agent (Restricted Tools)

```bash
claude --agents '{"analyzer": {"description": "Static code analyzer", "prompt": "Analyze code without making changes", "tools": ["Read", "Grep", "Glob"]}}' -p "Analyze the codebase"
```

## Character Escaping

When building the JSON programmatically, be aware of these escaping requirements:

1. **Double quotes in prompt**: Escape with backslash (`\"`)
2. **Newlines in prompt**: Use `\n` escape sequence
3. **Dollar signs**: May need escaping depending on shell (`\$`)
4. **Backslashes**: Double-escape (`\\`)

### TypeScript Example

```typescript
const agents = {
  "code-reviewer": {
    description: "Expert code reviewer",
    prompt: "You are a senior code reviewer.\nFocus on:\n- Code quality\n- Security\n- Best practices",
    tools: ["Read", "Grep", "Glob"],
    model: "haiku"
  }
};

const agentsJson = JSON.stringify(agents);
// Result: {"code-reviewer":{"description":"Expert code reviewer","prompt":"You are a senior code reviewer.\nFocus on:\n- Code quality\n- Security\n- Best practices","tools":["Read","Grep","Glob"],"model":"haiku"}}
```

## Size Limitations

Based on shell argument limits:
- **Recommended max**: 10KB for the entire `--agents` JSON string
- **Shell limit**: Typically 128KB-256KB on Unix systems, but varies by platform
- For large agent configurations, consider using file-based subagent definitions instead

## Error Handling

- **Invalid JSON**: The CLI may silently ignore invalid JSON and proceed without the agents
- **Missing required fields**: Behavior is undefined; always include `description` and `prompt`
- **Invalid tool names**: May cause runtime errors when the agent tries to use the tool
- **Invalid model names**: Falls back to default model

## Integration Notes

When using `--agents` with `ClaudeOrchestrator`:

1. Validate the JSON structure before passing to CLI
2. Use `JSON.stringify()` for proper serialization
3. Check serialized size is under 10KB
4. Combine with `--allowedTools` to restrict parent tools (agents inherit unless specified)

## References

- [Claude Code Sub-agents Documentation](https://code.claude.com/docs/en/sub-agents)
- [CLI Reference](https://code.claude.com/docs/en/cli-reference)
