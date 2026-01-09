# Agent Code Operations: Technical Documentation

## Table of Contents

1. [Overview](#overview)
2. [Task Tool and Subagent System](#task-tool-and-subagent-system)
3. [Agent Architecture](#agent-architecture)
4. [Code Reading Tools](#code-reading-tools)
5. [Code Writing Tools](#code-writing-tools)
6. [Tool System Architecture](#tool-system-architecture)
7. [Session and Message Flow](#session-and-message-flow)
8. [Safety and Context Management](#safety-and-context-management)
9. [Complete Flow Example](#complete-flow-example)

---

## Overview

OpenCode uses a sophisticated agent-tool architecture to read and write code safely and intelligently. This document provides a comprehensive technical analysis of how agents interact with code through tools, manage permissions, track changes, and maintain safety guarantees.

**Key Concepts:**

- **Agents**: AI assistants with different capabilities and permissions (build, plan, explore, general)
- **Tools**: Executable functions that agents can call (Read, Write, Edit, Bash, etc.)
- **Sessions**: Conversation contexts that manage message flow and tool execution
- **Permissions**: Hierarchical security system controlling tool access
- **Subagents**: Child agents spawned by the Task tool for complex multistep tasks

---

## Task Tool and Subagent System

**Location**: `packages/opencode/src/tool/task.ts`

### Purpose

The Task tool enables agents to spawn **subagents** - specialized child agents that autonomously handle complex, multistep tasks. This allows decomposition of large tasks into focused subtasks.

### Architecture

#### 1. Agent Filtering (lines 24-30)

```typescript
const agents = AgentRegistry.agents()
  .filter((agent) => agent.mode !== "primary")
  .filter((agent) => PermissionNext.evaluate(caller.permission, "task", [agent.id]).type === "allow")
```

- Lists all available agents from the registry
- Filters out primary agents (only subagents can be spawned)
- Checks caller's permissions to ensure they can invoke each agent
- Returns list of available subagent types for LLM's tool description

#### 2. Child Session Creation (lines 59-91)

When a subagent is spawned:

```typescript
const child = await Session.create({
  project: session.project,
  parentID: session.id,
  model: agent.model,
  permission: childPermissions,
  // ... other config
})
```

**Key aspects:**

- `parentID`: Links child to parent session for hierarchy
- **Restricted permissions**: Child sessions have additional restrictions:
  - `TodoWrite/TodoRead`: `deny` (prevents subagent todo manipulation)
  - `Task`: `deny` (prevents recursive subagent spawning)
- **Inherited context**: Gets parent's working directory and project settings

#### 3. Subagent Execution (lines 138-153)

```typescript
const result = await SessionPrompt.prompt({
  session: child,
  agent: agentType,
  model: input.model,
  text: input.prompt,
  disableTodo: true,
  disableTask: true,
})
```

**Execution flow:**

- Uses `SessionPrompt.prompt()` to run the task in child session
- Passes agent type (explore, general, etc.) and task description
- Disables todo/task tools explicitly
- Uses parent's model unless overridden in input
- Returns when subagent completes or fails

#### 4. Result Aggregation (lines 103-124)

The Task tool monitors subagent progress:

```typescript
const tools: Record<string, number> = {}

part.subscribe(MessageV2.Event.PartUpdated, (event) => {
  if (event.part.type === "tool") {
    const toolName = event.part.tool
    tools[toolName] = (tools[toolName] || 0) + 1
    ctx.metadata({
      tools: Object.entries(tools)
        .map(([name, count]) => `${name} (${count})`)
        .join(", "),
    })
  }
})
```

**Tracking:**

- Subscribes to child session's tool execution events
- Counts how many times each tool is called
- Updates parent UI with real-time progress
- Creates summary of all subagent activities

#### 5. Output Format (lines 169-178)

```typescript
return {
  title: `Task: ${input.description}`,
  output: response.text,
  metadata: {
    session_id: child.id, // For resume capability
    tools: toolsSummary,
  },
}
```

**Return value includes:**

- Subagent's final text response
- Session ID (enables resuming with `resume` parameter)
- Summary of all tools executed
- Title for UI display

### Subagent Types

**explore** (`packages/opencode/src/agent/explore.ts`):

- Fast, read-only agent for codebase exploration
- Tools: `Glob`, `Grep`, `Read`, `Bash` only
- Use case: Finding files, searching code, understanding structure

**general** (`packages/opencode/src/agent/general.ts`):

- General-purpose agent for research and multistep tasks
- Tools: All tools (Read, Write, Edit, Bash, WebFetch, etc.)
- Use case: Complex searches, data gathering, code analysis

---

## Agent Architecture

**Location**: `packages/opencode/src/agent/agent.ts`

### Agent Types

OpenCode defines two categories of agents:

#### Primary Agents (mode: "primary")

**build** - Full-access development agent:

- Default agent for interactive coding sessions
- Access to all tools with minimal restrictions
- Handles implementation, debugging, refactoring

**plan** - Read-only planning agent:

- Can only edit `.opencode/plan/*.md` files
- All other writes denied
- Used for planning implementations before execution

**title/summary/compaction** - Hidden utility agents:

- `title`: Generates conversation titles
- `summary`: Creates message summaries
- `compaction`: Compacts context when token limit approached

#### Subagents (mode: "subagent")

**general**:

- Invoked via Task tool with `@general`
- Full tool access for complex multistep tasks
- Research, code search, data analysis

**explore**:

- Fast read-only exploration
- Limited to: Glob, Grep, Read, Bash
- Codebase navigation and understanding

### Agent Configuration Structure

Each agent is defined with:

```typescript
{
  id: string                    // Agent identifier
  mode: "primary" | "subagent"  // Agent type
  permission: PermissionRuleset // Tool access rules
  model?: ModelID               // Override default model
  prompt?: string               // Custom system prompt
  temperature?: number          // Model temperature
  topP?: number                 // Model top_p
  steps?: number                // Max agentic loop iterations
  options?: Record<string, any> // Provider-specific settings
}
```

### Permission System

Agents use hierarchical permission rules:

```typescript
PermissionNext.merge(
  defaults, // Global defaults
  agentPermissions, // Agent-specific rules
  userConfig, // User's settings
  sessionPermissions, // Session overrides
)
```

**Example - plan agent** (lines 74-80):

```typescript
permission: PermissionNext.merge(
  defaults,
  PermissionNext.fromConfig({
    edit: {
      "*": "deny", // Deny all edits
      ".opencode/plan/*.md": "allow", // Except plan files
    },
  }),
  user,
)
```

**Permission types:**

- `allow`: Tool call proceeds immediately
- `deny`: Throws error, blocks execution
- `ask`: Pauses and shows permission UI to user

**Pattern matching:**

- Exact matches: `"src/config.ts"`
- Wildcards: `"*.env"`, `"src/**/*.test.ts"`
- Negation: `"!node_modules/**"`

### Agent Steps Limit

Agents can specify maximum agentic loop iterations:

```typescript
{
  steps: 5 // Max 5 iterations of LLM → tools → LLM
}
```

**Behavior:**

- On last step, system adds: "IMPORTANT: This is your FINAL step."
- Forces agent to complete or return partial result
- Prevents infinite loops in constrained agents

---

## Code Reading Tools

### Read Tool

**Location**: `packages/opencode/src/tool/read.ts`

#### Core Functionality

The Read tool enables agents to read file contents with safety checks, binary detection, and special format support.

#### 1. File Access Control (lines 29-40)

```typescript
// Check if file within workspace
if (!Filesystem.contains(session.workingDirectory, input.file_path)) {
  await ctx.ask({
    permission: "external_directory",
    patterns: [input.file_path],
  })
}

// Request read permission
await ctx.ask({
  permission: "read",
  patterns: [input.file_path],
})
```

**Security checks:**

- Verifies file is within workspace boundaries
- Requests `external_directory` permission for outside files
- Requests `read` permission for the specific file path
- Can be blocked by agent or user permissions

#### 2. Binary File Detection (lines 136-191)

**Two-stage detection:**

**Stage 1: Extension-based filtering**

```typescript
const binaryExtensions = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".class",
  ".pyc",
  // ... 50+ extensions
]
```

**Stage 2: Content analysis**

```typescript
const isBinary = (buffer: Buffer) => {
  // Check for null bytes
  if (buffer.includes(0)) return true

  // Count non-printable characters
  let nonPrintable = 0
  for (const byte of buffer) {
    if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) {
      nonPrintable++
    }
  }

  // >30% non-printable = binary
  return nonPrintable / buffer.length > 0.3
}
```

**If binary detected:**

```
Error: Cannot read binary file: /path/to/file.bin
```

#### 3. Special Format Support

**Images** (lines 70-92):

```typescript
if (mimeType?.startsWith("image/")) {
  const base64 = await file.arrayBuffer().then((buf) => Buffer.from(buf).toString("base64"))

  return {
    title: `Read: ${displayPath}`,
    output: `Image file: ${input.file_path}`,
    attachments: [
      {
        type: "file",
        name: path.basename(input.file_path),
        contentType: mimeType,
        data: base64,
      },
    ],
  }
}
```

- Detects images by MIME type (png, jpg, gif, etc.)
- Converts to base64
- Returns as attachment for multimodal LLM
- Agent can "see" the image visually

**PDFs** (similar flow):

- Extracts text content and visual elements
- Returns page-by-page representation
- Includes both text and images

**Jupyter Notebooks** (.ipynb):

- Parses JSON structure
- Returns cells with outputs
- Combines code, text, and visualizations

#### 4. Line-by-Line Reading (lines 97-120)

```typescript
const lines = content.split("\n")
const start = input.offset || 0
const end = Math.min(start + (input.limit || 2000), lines.length)

const formatted = lines
  .slice(start, end)
  .map((line, i) => {
    const lineNum = String(start + i + 1).padStart(5, "0")
    const truncated = line.length > 2000 ? line.slice(0, 2000) + "..." : line
    return `${lineNum}\t${truncated}`
  })
  .join("\n")
```

**Features:**

- Default limit: 2000 lines
- Supports offset/limit for pagination
- Line numbers in `cat -n` format: `00001\tcontent`
- Truncates individual lines >2000 chars
- Preserves exact whitespace and indentation

**Output example:**

```
00001	import { Session } from "./session"
00002	import { Agent } from "./agent"
00003
00004	export function createSession() {
00005	  return Session.create({
...
```

#### 5. File Tracking for Write Safety (lines 123-124)

```typescript
await LSP.touchFile(input.file_path) // Warm up LSP
await FileTime.read(input.file_path) // Record read timestamp
```

**Critical for safety:**

- `LSP.touchFile()`: Notifies language server about file access
- `FileTime.read()`: Records timestamp of read operation
- Later used by Write/Edit to detect concurrent modifications
- Prevents overwriting files changed since last read

#### 6. Error Handling

**File not found:**

```
Error: File not found: /path/to/file.ts
```

**Permission denied:**

```
Error: Permission denied for reading: /path/to/file.ts
```

**Binary file:**

```
Error: Cannot read binary file: /path/to/file.bin
Use a specialized tool for binary files.
```

---

## Code Writing Tools

### Edit Tool

**Location**: `packages/opencode/src/tool/edit.ts`

#### Purpose

The Edit tool performs **precise string replacement** in files using fuzzy matching algorithms to handle whitespace variations and formatting differences.

#### Architecture

#### 1. File Locking (lines 59-110)

```typescript
return await FileTime.withLock(input.file_path, async () => {
  // All edit logic here
})
```

**Purpose:**

- Serializes concurrent writes to the same file
- Prevents race conditions from multiple tool calls
- Uses file path as lock key
- Queues overlapping edits sequentially

#### 2. Read-Before-Write Enforcement (line 84)

```typescript
await FileTime.assert(input.file_path)
```

**Safety check:**

- Verifies file was read in current session
- Compares file's current mtime vs recorded read time
- Throws error if file modified since last read
- Forces agent to re-read before editing

**Error if violated:**

```
File has been modified since it was last read.
Last modification: 2025-01-07T20:15:30.000Z
Last read: 2025-01-07T20:10:00.000Z

Please read the file again before modifying it.
```

#### 3. Fuzzy String Matching (lines 625-635)

The Edit tool tries **9 different replacement strategies** in order:

```typescript
const replacers = [
  new SimpleReplacer(), // 1. Exact match
  new LineTrimmedReplacer(), // 2. Trim each line
  new BlockAnchorReplacer(), // 3. First/last line + similarity
  new WhitespaceNormalizedReplacer(), // 4. Normalize all whitespace
  new IndentationFlexibleReplacer(), // 5. Ignore indentation
  new EscapeNormalizedReplacer(), // 6. Handle escape sequences
  new TrimmedBoundaryReplacer(), // 7. Trim start/end
  new ContextAwareReplacer(), // 8. Use surrounding context
  new MultiOccurrenceReplacer(), // 9. Find all exact matches
]

for (const replacer of replacers) {
  const result = replacer.replace(content, oldString, newString)
  if (result.success) {
    return result.content
  }
}
```

**Strategy details:**

**SimpleReplacer:**

- Exact string match: `content.includes(oldString)`
- Fastest, most reliable
- Fails if any character differs

**LineTrimmedReplacer:**

- Trims whitespace from each line
- Handles copy-paste whitespace differences
- Preserves indentation structure

**BlockAnchorReplacer:**

- Uses first and last line as anchors
- Finds block with similar content in middle
- Handles minor variations in middle lines

**WhitespaceNormalizedReplacer:**

- Collapses all whitespace to single spaces
- Handles formatting differences
- Most permissive whitespace handling

**IndentationFlexibleReplacer:**

- Detects indentation differences
- Adjusts oldString to match file's indentation
- Handles tab vs space differences

**MultiOccurrenceReplacer:**

- Finds all exact matches
- Asks user which occurrence to replace
- Prevents ambiguous replacements

**If all fail:**

```
Error: Could not find the specified string in the file.

The string to replace was not found. This could be because:
1. The string doesn't exist in the file
2. The whitespace or indentation doesn't match exactly
3. The file has been modified since you last read it

Please read the file again and ensure the old_string matches exactly.
```

#### 4. Permission Request (lines 88-109)

```typescript
const diff = createTwoFilesPatch(
  input.file_path,
  input.file_path,
  content,
  newContent,
  "", // old file header
  "", // new file header
)

await ctx.ask({
  permission: "edit",
  patterns: [input.file_path],
  always: [input.file_path],
  metadata: {
    diff: trimDiff(diff),
    additions,
    deletions,
  },
})
```

**Permission UI shows:**

- Unified diff with colors (+ green, - red)
- Number of additions/deletions
- File path being modified
- Options: Allow, Deny, Always allow for this file

#### 5. LSP Integration (lines 133-143)

```typescript
await LSP.touchFile(input.file_path)

const diagnostics = await LSP.diagnostics({
  includeFile: input.file_path,
  limit: 20, // Max 20 errors in edited file
  otherLimit: 5, // Max 5 other files with errors
})
```

**After editing:**

- Notifies LSP server of file change
- Fetches type errors, linting errors, warnings
- Returns diagnostics to agent
- Agent can see errors and fix them immediately

**Diagnostic output example:**

```
The file was edited successfully.

TypeScript errors found:
src/auth.ts:45:12 - error TS2339: Property 'username' does not exist on type 'User'.
src/auth.ts:67:5 - error TS2322: Type 'string' is not assignable to type 'number'.
```

#### 6. Snapshot Tracking (lines 112-123)

```typescript
await FileTime.update(input.file_path)

ctx.metadata({
  diff: trimDiff(diff),
  additions,
  deletions,
})
```

**Change tracking:**

- Records new file modification time
- Publishes `File.Event.Edited` event
- Snapshot system captures change for undo/revert
- UI displays diff in conversation

### Write Tool

**Location**: `packages/opencode/src/tool/write.ts`

#### Purpose

The Write tool **overwrites entire files** with new content. Simpler than Edit but still includes safety checks.

#### Key Differences from Edit

**No fuzzy matching:**

- Replaces entire file content
- No need for string search/replace
- More straightforward for new files or complete rewrites

**Same safety guarantees:**

- Read-before-write assertion
- Permission requests with diff
- LSP diagnostics
- Snapshot tracking

#### Flow (lines 30-72)

```typescript
// 1. Check if file exists and was read
const exists = await file.exists()
if (exists) {
  await FileTime.assert(input.file_path)
}

// 2. Generate diff for permission request
const oldContent = exists ? await file.text() : ""
const diff = createTwoFilesPatch(input.file_path, input.file_path, oldContent, input.content, "", "")

// 3. Request permission (uses "edit" permission like Edit tool)
await ctx.ask({
  permission: "edit",
  patterns: [input.file_path],
  always: [input.file_path],
  metadata: { diff: trimDiff(diff) },
})

// 4. Write file
await Bun.write(input.file_path, input.content)

// 5. Publish change event
await File.Event.Edited.publish({ path: input.file_path })

// 6. Update tracking
await FileTime.update(input.file_path)

// 7. Get LSP diagnostics
await LSP.touchFile(input.file_path)
const diagnostics = await LSP.diagnostics({
  includeFile: input.file_path,
  limit: 20,
  otherLimit: 5,
})

// 8. Return result with diagnostics
return {
  title: `Write: ${displayPath}`,
  output: formatDiagnostics(diagnostics),
}
```

#### When to Use Write vs Edit

**Use Edit when:**

- Making targeted changes to specific sections
- Changing a few lines in a large file
- Agent read the file and knows exact location
- Want to preserve surrounding code exactly

**Use Write when:**

- Creating new files
- Complete file rewrites
- Generated content (e.g., config files)
- File is small (<100 lines)

---

## Tool System Architecture

**Location**: `packages/opencode/src/tool/tool.ts`

### Tool Definition Structure

Every tool implements the `Tool.Info` interface:

```typescript
interface Tool.Info<P extends ZodSchema, M = unknown> {
  id: string  // Unique tool identifier

  init: (ctx?: InitContext) => Promise<{
    description: string           // LLM-facing description
    parameters: P                 // Zod schema for validation

    execute(
      args: z.infer<P>,
      ctx: Tool.Context
    ): Promise<Tool.Result<M>>

    formatValidationError?: (error: ZodError) => string
  }>
}
```

### Tool Context

When executing, tools receive `Tool.Context`:

```typescript
interface Tool.Context {
  // Identity
  sessionID: string
  messageID: string
  agent: string
  callID: string

  // Control
  abort: AbortSignal

  // Interaction
  metadata(data: Record<string, any>): void
  ask(request: PermissionRequest): Promise<void>
}
```

**Context methods:**

**`ctx.metadata(data)`:**

- Updates tool UI in real-time
- Shows progress, status, intermediate results
- Example: Task tool showing subagent progress

**`ctx.ask(request)`:**

- Requests user permission
- Pauses execution until user responds
- Throws `DeniedError` if denied

### Permission Request Structure

```typescript
interface PermissionRequest {
  permission: string // Permission key (e.g., "edit", "bash")
  patterns: string[] // What's being accessed
  always?: string[] // Patterns to save if "always" chosen
  metadata?: Record<string, any> // Additional context for UI
}
```

**Example - Edit tool permission:**

```typescript
await ctx.ask({
  permission: "edit",
  patterns: ["src/auth.ts"],
  always: ["src/auth.ts"],
  metadata: {
    diff: "- const x = 1\n+ const x = 2",
    additions: 1,
    deletions: 1,
  },
})
```

**UI displays:**

- Permission type: "Edit file"
- File path: "src/auth.ts"
- Diff preview with syntax highlighting
- Buttons: Allow, Deny, Always allow src/auth.ts

### Tool Result Structure

```typescript
interface Tool.Result<M = unknown> {
  title: string                   // Short title for UI
  output: string                  // Text returned to LLM
  metadata?: M                    // Structured data for UI
  attachments?: FilePart[]        // Images, files, etc.
}
```

**Examples:**

**Read tool:**

```typescript
{
  title: "Read: src/auth.ts",
  output: "00001\timport { hash } from './crypto'\n00002\t...",
  metadata: {
    file_path: "src/auth.ts",
    lines: 150,
  }
}
```

**Edit tool:**

```typescript
{
  title: "Edit: src/auth.ts",
  output: "File edited successfully.\n\nTypeScript: No errors.",
  metadata: {
    diff: "...",
    additions: 5,
    deletions: 3,
  }
}
```

**Task tool:**

```typescript
{
  title: "Task: Search for auth implementation",
  output: "Found authentication in 3 files:\n1. src/auth.ts - main logic\n...",
  metadata: {
    session_id: "session_abc123",
    tools: "Grep (5), Read (3), Glob (2)",
  }
}
```

### Tool Registry

**Location**: `packages/opencode/src/tool/registry.ts`

All tools are registered in `ToolRegistry`:

```typescript
export const ToolRegistry = {
  tools(): Tool.Info[] {
    return [
      ReadTool,
      WriteTool,
      EditTool,
      BashTool,
      GrepTool,
      GlobTool,
      LSPTool,
      TaskTool,
      TodoWriteTool,
      // ... more tools
    ]
  },
}
```

**Registration process:**

1. Tool implements `Tool.Info<Parameters, Metadata>`
2. Export from tool module
3. Import in registry
4. Add to `tools()` array

**Tool resolution** (`packages/opencode/src/session/prompt.ts` lines 641-789):

```typescript
async function resolveTools(session: Session, agent: Agent) {
  const tools = []

  // 1. Get all registered tools
  for (const tool of ToolRegistry.tools()) {
    // 2. Check agent permissions
    const perm = PermissionNext.evaluate(agent.permission, tool.id, [])

    if (perm.type === "deny") continue

    // 3. Initialize tool
    const info = await tool.init(session)

    // 4. Wrap execute with permission checks
    const execute = async (args) => {
      // Permission checking
      // Plugin hooks
      // Metadata updates
      return await info.execute(args, ctx)
    }

    tools.push({
      name: tool.id,
      description: info.description,
      parameters: info.parameters,
      execute,
    })
  }

  // 5. Add MCP tools
  const mcpTools = await MCP.tools(session)
  tools.push(...mcpTools)

  return tools
}
```

---

## Session and Message Flow

**Location**: `packages/opencode/src/session/`

### Architecture Overview

```
User Request
    ↓
SessionPrompt.prompt()
    ↓
SessionPrompt.loop() ← Agentic loop
    ├─ Fetch history
    ├─ Check pending tasks
    ├─ Create assistant message
    ├─ Resolve tools
    └─ Stream LLM response
         ↓
    SessionProcessor.process()
         ├─ text-delta → accumulate
         ├─ tool-call → create part
         ├─ tool-result → execute tool
         ├─ tool-error → handle error
         └─ finish-step → compute cost
              ↓
         Tool.execute()
              ├─ Permission checks
              ├─ File operations
              ├─ LSP diagnostics
              └─ Return result
                   ↓
              Back to LLM (if more steps)
                   ↓
         Loop continues until:
         - finish reason = "stop"
         - permission denied
         - max steps reached
```

### SessionPrompt.loop()

**Location**: `packages/opencode/src/session/prompt.ts` lines 257-632

The main agentic loop that powers agent behavior:

```typescript
async function loop(options: {
  session: Session
  agent: string
  model?: string
  text: string
  disableTodo?: boolean
  disableTask?: boolean
}): Promise<LoopResult> {
  while (true) {
    // 1. Fetch conversation history
    const messages = await MessageV2.list(session.id)

    // 2. Find last user and assistant messages
    const lastUser = findLast(messages, (m) => m.role === "user")
    const lastAssistant = findLast(messages, (m) => m.role === "assistant")

    // 3. Check for pending tasks
    if (needsCompaction(messages)) {
      await compactContext(session)
      continue
    }

    if (hasSubtask(lastAssistant)) {
      await processSubtask(session, lastAssistant)
      continue
    }

    // 4. Create new assistant message
    const message = await MessageV2.create({
      sessionID: session.id,
      role: "assistant",
      agent: options.agent,
    })

    // 5. Resolve available tools
    const tools = await resolveTools(session, agent)

    // 6. Stream LLM response
    const processor = SessionProcessor.create({
      session,
      message,
      agent,
    })

    const stream = LLM.stream({
      model: options.model || agent.model,
      messages: formatMessages(messages),
      tools,
      temperature: agent.temperature,
      topP: agent.topP,
    })

    for await (const event of stream) {
      await processor.process(event)
    }

    // 7. Check finish reason
    const finish = processor.finishReason()

    if (finish === "stop" || finish === "length") {
      break // Done
    }

    if (finish === "tool-calls") {
      continue // Execute tools and loop again
    }

    if (finish === "permission-denied") {
      if (!continueOnDeny) break
      continue
    }

    // 8. Check step limit
    if (agent.steps && currentStep >= agent.steps) {
      await injectFinalStepWarning()
      continue // Force final attempt
    }
  }

  return {
    message,
    text: processor.text(),
    cost: processor.cost(),
  }
}
```

**Key aspects:**

**Pending task detection:**

- Compaction: Token limit exceeded, need to summarize
- Subtasks: Previous message has subtask that needs execution

**Tool resolution:**

- Filters tools by agent permissions
- Wraps each tool's execute with permission/plugin hooks
- Includes MCP tools from connected servers

**Finish reasons:**

- `stop`: Normal completion, agent finished
- `length`: Hit max tokens, need compaction
- `tool-calls`: Agent wants to call tools, continue loop
- `permission-denied`: User denied permission

**Step limiting:**

- Tracks iterations through loop
- On last step, injects "FINAL step" warning
- Forces agent to complete or fail

### SessionProcessor.process()

**Location**: `packages/opencode/src/session/processor.ts` lines 44-401

Processes LLM streaming events:

```typescript
class SessionProcessor {
  async process(event: LLM.Event) {
    switch (event.type) {
      case "text-delta":
        await this.handleTextDelta(event)
        break

      case "tool-call":
        await this.handleToolCall(event)
        break

      case "tool-result":
        await this.handleToolResult(event)
        break

      case "tool-error":
        await this.handleToolError(event)
        break

      case "finish-step":
        await this.handleFinishStep(event)
        break

      case "reasoning":
        await this.handleReasoning(event)
        break
    }
  }
}
```

**Event handling:**

**text-delta** (lines 60-75):

```typescript
async handleTextDelta(event: TextDelta) {
  this.textBuffer += event.delta

  // Create text part if not exists
  if (!this.currentTextPart) {
    this.currentTextPart = await MessagePart.create({
      messageID: this.message.id,
      type: "text",
      text: "",
    })
  }

  // Update text part
  await MessagePart.update(this.currentTextPart.id, {
    text: this.textBuffer
  })

  // Publish update event
  await MessageV2.Event.PartUpdated.publish({
    part: this.currentTextPart
  })
}
```

**tool-call** (lines 143-210):

```typescript
async handleToolCall(event: ToolCall) {
  // 1. Doom loop detection
  const recentCalls = this.getRecentToolCalls(3)
  if (this.isIdenticalCalls(recentCalls)) {
    const shouldContinue = await this.askUserAboutLoop()
    if (!shouldContinue) {
      throw new Error("Doom loop detected")
    }
  }

  // 2. Create tool part
  const part = await MessagePart.create({
    messageID: this.message.id,
    type: "tool",
    tool: event.name,
    input: event.arguments,
    status: "pending",
  })

  // 3. Find tool implementation
  const tool = this.tools.find(t => t.name === event.name)
  if (!tool) {
    await MessagePart.update(part.id, {
      status: "error",
      error: `Unknown tool: ${event.name}`,
    })
    return
  }

  // 4. Execute tool (async, result comes in tool-result event)
  this.executingTools.set(event.id, { part, tool })
}
```

**tool-result** (lines 212-275):

```typescript
async handleToolResult(event: ToolResult) {
  const { part, tool } = this.executingTools.get(event.id)

  try {
    // 1. Parse arguments
    const args = tool.parameters.parse(event.arguments)

    // 2. Execute tool
    const result = await tool.execute(args, this.createContext(part))

    // 3. Update part with result
    await MessagePart.update(part.id, {
      status: "success",
      output: result.output,
      metadata: result.metadata,
      attachments: result.attachments,
    })

    // 4. Update snapshot
    await Snapshot.track(this.session.id, part.id)

  } catch (error) {
    // Handle errors
    if (error instanceof DeniedError) {
      await MessagePart.update(part.id, {
        status: "denied",
        error: error.message,
      })
      this.finishReason = "permission-denied"
    } else {
      await MessagePart.update(part.id, {
        status: "error",
        error: error.message,
      })
    }
  }
}
```

**finish-step** (lines 320-365):

```typescript
async handleFinishStep(event: FinishStep) {
  // 1. Compute token usage
  const usage = {
    inputTokens: event.usage.input,
    outputTokens: event.usage.output,
    cacheReadTokens: event.usage.cacheRead,
    cacheWriteTokens: event.usage.cacheWrite,
  }

  // 2. Calculate cost
  const cost = this.calculateCost(
    this.model,
    usage.inputTokens,
    usage.outputTokens,
    usage.cacheReadTokens,
    usage.cacheWriteTokens
  )

  // 3. Store in message metadata
  await MessageV2.update(this.message.id, {
    metadata: {
      usage,
      cost,
      finishReason: event.reason,
    }
  })

  // 4. Set processor finish reason
  this.finishReason = event.reason
}
```

**Doom loop detection** (lines 143-167):

Prevents infinite loops:

```typescript
function detectDoomLoop() {
  const recent = this.toolCalls.slice(-3)

  if (recent.length < 3) return false

  const [call1, call2, call3] = recent

  return (
    call1.tool === call2.tool &&
    call2.tool === call3.tool &&
    JSON.stringify(call1.args) === JSON.stringify(call2.args) &&
    JSON.stringify(call2.args) === JSON.stringify(call3.args)
  )
}
```

If detected:

- Pauses execution
- Shows user: "Agent is calling the same tool repeatedly"
- User can allow continuation or stop

### resolveTools()

**Location**: `packages/opencode/src/session/prompt.ts` lines 641-789

Creates tool execution wrappers with permission checks:

```typescript
async function resolveTools(
  session: Session,
  agent: Agent,
  options: {
    disableTodo?: boolean
    disableTask?: boolean
  },
) {
  const resolved = []

  for (const toolInfo of ToolRegistry.tools()) {
    // 1. Check agent permission
    const perm = PermissionNext.evaluate(agent.permission, toolInfo.id, [])

    if (perm.type === "deny") continue

    // 2. Check disable flags
    if (options.disableTodo && toolInfo.id === "TodoWrite") continue
    if (options.disableTask && toolInfo.id === "Task") continue

    // 3. Initialize tool
    const tool = await toolInfo.init({
      session,
      agent,
    })

    // 4. Wrap execute with middleware
    const execute = async (args, ctx) => {
      // Before plugin hooks
      await Plugin.beforeTool(session, toolInfo.id, args)

      // Execute actual tool
      const result = await tool.execute(args, ctx)

      // After plugin hooks
      await Plugin.afterTool(session, toolInfo.id, result)

      return result
    }

    resolved.push({
      name: toolInfo.id,
      description: tool.description,
      parameters: tool.parameters,
      execute,
    })
  }

  // 5. Add MCP tools
  const mcpTools = await MCP.getTools(session)
  resolved.push(...mcpTools)

  return resolved
}
```

**Middleware layers:**

1. **Permission evaluation**: Check if agent can use tool
2. **Disable flags**: Respect session-level disables
3. **Plugin hooks**: Before/after tool execution
4. **Context creation**: Build `Tool.Context` with ask/metadata
5. **Error handling**: Convert errors to structured format

---

## Safety and Context Management

### FileTime Tracking

**Location**: `packages/opencode/src/file/time.ts`

#### Purpose

Prevents overwriting files that have been modified since the agent last read them.

#### Mechanism

```typescript
class FileTime {
  // Maps file path -> timestamp of last read
  private static reads = new Map<string, Date>()

  // Lock for serializing writes to same file
  private static locks = new Map<string, Promise<void>>()

  static async read(path: string) {
    const stat = await Bun.file(path).stat()
    this.reads.set(path, new Date(stat.mtime))
  }

  static async assert(path: string) {
    const lastRead = this.reads.get(path)
    if (!lastRead) {
      throw new Error("File has not been read in this session. " + "Please read the file before modifying it.")
    }

    const stat = await Bun.file(path).stat()
    const currentMtime = new Date(stat.mtime)

    if (currentMtime > lastRead) {
      throw new Error(
        `File has been modified since it was last read.\n` +
          `Last modification: ${currentMtime.toISOString()}\n` +
          `Last read: ${lastRead.toISOString()}\n\n` +
          `Please read the file again before modifying it.`,
      )
    }
  }

  static async update(path: string) {
    const stat = await Bun.file(path).stat()
    this.reads.set(path, new Date(stat.mtime))
  }

  static async withLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
    // Wait for any existing lock
    while (this.locks.has(path)) {
      await this.locks.get(path)
    }

    // Create new lock
    let release: () => void
    const lock = new Promise<void>((resolve) => {
      release = resolve
    })
    this.locks.set(path, lock)

    try {
      return await fn()
    } finally {
      this.locks.delete(path)
      release!()
    }
  }
}
```

#### Flow

**On Read:**

```typescript
await FileTime.read("src/auth.ts")
// Records: src/auth.ts -> 2025-01-07T20:00:00.000Z
```

**On Edit/Write:**

```typescript
await FileTime.assert("src/auth.ts")
// Checks: File's current mtime <= recorded read time
// If file changed externally: throws error
// If unchanged: proceeds
```

**After Edit/Write:**

```typescript
await FileTime.update("src/auth.ts")
// Updates: src/auth.ts -> 2025-01-07T20:05:00.000Z
```

#### Benefits

- **Prevents data loss**: Won't overwrite external changes
- **Multi-agent safety**: Multiple agents can't conflict
- **External editor safety**: Respects user's manual edits
- **Concurrent write safety**: Serializes writes to same file

### Snapshot System

**Location**: `packages/opencode/src/snapshot/index.ts`

#### Purpose

Tracks all file changes for undo/revert functionality.

#### Architecture

Uses a **separate git repository** in `.opencode/git/`:

```typescript
class Snapshot {
  static async init(workingDirectory: string) {
    const gitDir = path.join(workingDirectory, ".opencode/git")

    // Initialize bare git repo
    await exec("git init --bare", { cwd: gitDir })

    // Set working tree to actual project directory
    await exec(`git --git-dir=${gitDir} --work-tree=${workingDirectory} add -A`)
  }

  static async track(sessionID: string, partID: string) {
    // 1. Create tree object from current state
    const tree = await exec("git write-tree")

    // 2. Store tree hash with metadata
    await SnapshotRecord.create({
      sessionID,
      partID,
      tree: tree.trim(),
      timestamp: new Date(),
    })

    return tree
  }

  static async patch(tree: string) {
    // 1. Get current state
    const currentTree = await exec("git write-tree")

    // 2. Diff between trees
    const diff = await exec(`git diff-tree --name-status ${tree} ${currentTree}`)

    // 3. Parse changed files
    const files = diff
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [status, path] = line.split("\t")
        return { status, path }
      })

    return files
  }

  static async restore(tree: string) {
    // 1. Checkout tree
    await exec(`git read-tree ${tree}`)

    // 2. Restore working directory
    await exec("git checkout-index -a -f")

    // 3. Update FileTime tracking
    const files = await exec("git ls-tree -r --name-only ${tree}")
    for (const file of files.split("\n")) {
      await FileTime.update(file)
    }
  }

  static async revert(partID: string) {
    // 1. Find snapshot for this part
    const snapshot = await SnapshotRecord.findByPart(partID)

    // 2. Get previous snapshot
    const previous = await SnapshotRecord.findPrevious(snapshot.id)

    // 3. Restore to previous state
    await this.restore(previous.tree)
  }
}
```

#### Flow

**Before each step:**

```typescript
const tree = await Snapshot.track(session.id, message.id)
// Creates git tree object: "a3f8d92..."
```

**After step completes:**

```typescript
const changes = await Snapshot.patch(tree)
// Returns: [
//   { status: "M", path: "src/auth.ts" },
//   { status: "A", path: "src/user.ts" },
// ]

// Create patch part in message
await MessagePart.create({
  messageID: message.id,
  type: "patch",
  files: changes,
})
```

**User reverts:**

```typescript
await Snapshot.revert(toolPartID)
// Restores working directory to before that tool executed
```

#### Benefits

- **Complete history**: Every file change tracked
- **Instant undo**: Restore to any previous state
- **No git pollution**: Uses separate `.opencode/git` directory
- **Visual feedback**: Shows changed files in UI

### Context Compaction

**Location**: `packages/opencode/src/session/compaction.ts`

#### Purpose

Enables "unlimited context" by automatically summarizing old messages when token limit approached.

#### Algorithm

```typescript
async function compact(session: Session) {
  // 1. Get all messages
  const messages = await MessageV2.list(session.id)

  // 2. Find compaction boundary
  //    - Keep recent N messages (e.g., last 20)
  //    - Compact older messages
  const boundary = messages.length - 20
  const toCompact = messages.slice(0, boundary)
  const toKeep = messages.slice(boundary)

  // 3. Create compaction task
  const summary = await SessionPrompt.prompt({
    session,
    agent: "compaction",
    text: formatMessagesForCompaction(toCompact),
  })

  // 4. Replace old messages with summary
  await MessageV2.deleteMany(toCompact.map((m) => m.id))
  await MessageV2.create({
    sessionID: session.id,
    role: "assistant",
    type: "compaction",
    text: summary.text,
    metadata: {
      compactedMessages: toCompact.length,
      originalTokens: estimateTokens(toCompact),
      summaryTokens: estimateTokens(summary.text),
    },
  })

  // 5. Continue conversation
  return toKeep
}
```

**Compaction agent prompt:**

```
You are summarizing a conversation to reduce token usage.

Summarize the following messages, preserving:
- Key decisions made
- Code changes and their rationale
- Important errors encountered
- Context needed for future messages

Be concise but comprehensive. Format as:

## Summary
[High-level overview]

## Key Changes
- [File]: [What changed and why]

## Important Context
- [Any context needed for future work]
```

#### Trigger Conditions

**Proactive compaction:**

- Triggered when estimated tokens > 80% of context limit
- Runs between agentic loop iterations
- Transparent to user

**Forced compaction:**

- Finish reason = "length" (hit token limit)
- Immediately compact before next iteration

#### Benefits

- **Unlimited conversation length**: No context limit in practice
- **Preserves important info**: Summarization retains key details
- **Automatic**: User doesn't need to manage context
- **Cost efficient**: Reduces token usage over time

### Multi-Step Agent Control

**Location**: `packages/opencode/src/agent/agent.ts`

#### Purpose

Limits how many iterations an agent can perform, forcing completion or failure.

#### Configuration

```typescript
{
  id: "explore",
  steps: 5,  // Max 5 agentic loop iterations
  // ... other config
}
```

#### Enforcement

**In SessionPrompt.loop():**

```typescript
let currentStep = 0

while (true) {
  currentStep++

  // ... execute LLM call and tools ...

  if (agent.steps && currentStep >= agent.steps) {
    // Inject final step warning
    await MessageV2.create({
      sessionID: session.id,
      role: "system",
      text: "IMPORTANT: This is your FINAL step. You must complete the task now or return your best attempt.",
    })

    // Give agent one more chance
    currentStep = 0 // Reset for final attempt
    finalAttempt = true
    continue
  }

  if (finalAttempt && finishReason !== "tool-calls") {
    // Agent completed or gave up
    break
  }
}
```

#### Use Cases

**explore agent (steps: 5)**:

- Fast, focused exploration
- Prevents over-exploration
- Forces concise results

**general agent (steps: 10)**:

- More complex tasks allowed
- Still bounded to prevent runaway

**build agent (no limit)**:

- Primary agent for implementation
- Can iterate as needed

#### Benefits

- **Predictable cost**: Bounded LLM calls
- **Prevents runaway**: Agents can't loop forever
- **Forces focus**: Encourages efficient tool use
- **Clear feedback**: "Final step" warning helps agent prioritize

---

## Complete Flow Example

### Scenario: User asks to "Fix the bug in auth.ts"

#### Step-by-Step Execution

**1. User Message Creation**

```typescript
// User types in TUI: "Fix the bug in auth.ts"

const userMessage = await MessageV2.create({
  sessionID: session.id,
  role: "user",
  text: "Fix the bug in auth.ts",
})
```

**2. Session Loop Starts**

```typescript
const result = await SessionPrompt.loop({
  session,
  agent: "build",
  text: "Fix the bug in auth.ts",
})
```

**3. Agent Decides to Read File**

```typescript
// LLM returns tool call:
{
  type: "tool-call",
  id: "call_001",
  name: "Read",
  arguments: {
    file_path: "/Users/alex/project/src/auth.ts"
  }
}
```

**4. Read Tool Executes**

```typescript
// SessionProcessor.handleToolResult()

// a. Permission check
await ctx.ask({
  permission: "read",
  patterns: ["/Users/alex/project/src/auth.ts"],
})
// -> Evaluates to "allow" (build agent has read access)

// b. Read file
const content = await Bun.file(file_path).text()

// c. Track read time
await FileTime.read(file_path)
// Records: auth.ts -> 2025-01-07T20:00:00.000Z

// d. Format with line numbers
const formatted = content
  .split("\n")
  .map((line, i) => `${String(i + 1).padStart(5, "0")}\t${line}`)
  .join("\n")

// e. Return to LLM
return {
  title: "Read: src/auth.ts",
  output: formatted,
}
```

**5. Agent Analyzes Bug**

```typescript
// LLM receives file content and responds with text:
{
  type: "text-delta",
  delta: "I found the bug on line 45. The password comparison is using..."
}

// Then calls Edit tool:
{
  type: "tool-call",
  id: "call_002",
  name: "Edit",
  arguments: {
    file_path: "/Users/alex/project/src/auth.ts",
    old_string: "if (password == user.password) {",
    new_string: "if (await hash.compare(password, user.password)) {"
  }
}
```

**6. Edit Tool Executes**

```typescript
// a. Acquire file lock
await FileTime.withLock(file_path, async () => {
  // b. Assert file unchanged since read
  await FileTime.assert(file_path)
  // Checks: current mtime (20:00:00) <= read time (20:00:00) ✓

  // c. Read current content
  const content = await Bun.file(file_path).text()

  // d. Find and replace with fuzzy matching
  const newContent = SimpleReplacer.replace(content, old_string, new_string)

  // e. Generate diff
  const diff = createTwoFilesPatch(file_path, file_path, content, newContent)

  // f. Request permission
  await ctx.ask({
    permission: "edit",
    patterns: [file_path],
    always: [file_path],
    metadata: {
      diff: trimDiff(diff),
      additions: 1,
      deletions: 1,
    },
  })
  // -> User sees diff in UI, clicks "Allow"

  // g. Write file
  await Bun.write(file_path, newContent)

  // h. Update tracking
  await FileTime.update(file_path)
  // Updates: auth.ts -> 2025-01-07T20:05:00.000Z

  // i. Notify LSP
  await LSP.touchFile(file_path)

  // j. Get diagnostics
  const diagnostics = await LSP.diagnostics({
    includeFile: file_path,
    limit: 20,
  })

  // k. Return result
  return {
    title: "Edit: src/auth.ts",
    output: formatDiagnostics(diagnostics),
    metadata: { diff, additions: 1, deletions: 1 },
  }
})
```

**7. Snapshot Captures Change**

```typescript
// After tool completes

// a. Create git tree snapshot
const tree = await exec("git --git-dir=.opencode/git write-tree")
// Returns: "b7d9e3a..."

// b. Find changed files
const patch = await exec(`git diff-tree --name-status ${prevTree} ${tree}`)
// Returns: "M\tsrc/auth.ts"

// c. Create patch part
await MessagePart.create({
  messageID: assistantMessage.id,
  type: "patch",
  files: [{ status: "M", path: "src/auth.ts" }],
  metadata: { tree },
})
```

**8. Agent Completes**

```typescript
// LLM returns final text:
{
  type: "text-delta",
  delta: "Fixed! Changed line 45 to use secure password comparison."
}

{
  type: "finish-step",
  reason: "stop",
  usage: {
    input: 5234,
    output: 421,
    cacheRead: 3180,
    cacheWrite: 0
  }
}
```

**9. Loop Exits**

```typescript
// SessionPrompt.loop() sees finish reason = "stop"
// Returns final result

return {
  message: assistantMessage,
  text: "Fixed! Changed line 45 to use secure password comparison.",
  cost: 0.0234, // Calculated from token usage
}
```

**10. UI Updates**

```typescript
// TUI displays:
//
// Claude:
// I found the bug on line 45. The password comparison is using == instead of
// secure comparison.
//
// [Edit: src/auth.ts]
// - if (password == user.password) {
// + if (await hash.compare(password, user.password)) {
//
// Fixed! Changed line 45 to use secure password comparison.
```

### Complete Data Flow Summary

```
User Input: "Fix the bug in auth.ts"
    ↓
SessionPrompt.loop()
    ↓
LLM decides: Read(auth.ts)
    ↓
Read Tool:
  - Permission check ✓
  - Read file content
  - Track: FileTime.read(auth.ts, 20:00:00)
  - Return 150 lines to LLM
    ↓
LLM analyzes and decides: Edit(auth.ts, old, new)
    ↓
Edit Tool:
  - Lock file
  - Assert: FileTime.assert(auth.ts) ✓
  - Find old_string with fuzzy matching
  - Generate diff
  - Permission check (shows diff to user) ✓
  - Write new content
  - Update: FileTime.update(auth.ts, 20:05:00)
  - LSP.touchFile(auth.ts)
  - LSP.diagnostics() -> no errors
  - Return success to LLM
    ↓
Snapshot.patch():
  - git write-tree -> "b7d9e3a"
  - git diff-tree -> M auth.ts
  - Create patch part in message
    ↓
LLM returns: finish reason = "stop"
    ↓
Loop exits, returns final message
    ↓
UI renders result with diff
```

### Safety Guarantees Demonstrated

1. **Permission checks**: Both Read and Edit requested permission
2. **Read-before-write**: Edit verified file was read first
3. **Concurrency safety**: File lock prevented simultaneous edits
4. **External change detection**: FileTime would catch if user edited externally
5. **LSP integration**: Type errors shown to agent immediately
6. **Change tracking**: Snapshot captured change for undo/revert
7. **User visibility**: Diff shown to user before writing

---

## Conclusion

OpenCode's agent system provides a sophisticated, safe, and extensible architecture for AI-assisted coding:

**Key Strengths:**

1. **Safety First**: Multiple layers (FileTime, permissions, locks) prevent data loss
2. **Flexible Tool System**: Easy to add new capabilities via Tool.Info interface
3. **Hierarchical Agents**: Subagents enable task decomposition and specialization
4. **Context Management**: Compaction enables unlimited conversation length
5. **Change Tracking**: Complete history with instant undo via snapshot system
6. **LSP Integration**: Real-time type checking and error feedback
7. **User Control**: Permission system gives users fine-grained control

**Architecture Highlights:**

- **Session-based**: Each conversation is isolated with its own state
- **Event-driven**: Pub/sub for file changes, tool executions, message updates
- **Async throughout**: Non-blocking tool execution and streaming
- **Type-safe**: Zod schemas for tool parameters, TypeScript everywhere
- **Extensible**: Plugin hooks, MCP integration, custom tools

This architecture enables OpenCode to provide a powerful yet safe AI coding experience where agents can autonomously read, analyze, and modify code while maintaining strong guarantees against data loss and unintended changes.
