# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

OpenCode is an open-source AI coding agent with a client-server architecture. The project is a monorepo using Bun workspaces and Turbo for builds.

**Default Branch**: `dev` (use this for PRs, not `main`)

## Development Commands

### Quick Start

```bash
bun install              # Install dependencies
bun dev                  # Run OpenCode TUI in packages/opencode directory
bun dev <directory>      # Run OpenCode against a specific directory
bun dev .                # Run OpenCode in repo root
```

### Testing

```bash
bun test                 # Run tests (from packages/opencode)
bun run --cwd packages/opencode test
```

### Building

```bash
bun turbo typecheck      # Type check all packages
bun run --cwd packages/opencode build     # Build opencode package
./packages/opencode/script/build.ts --single  # Build standalone executable

# Desktop app
bun run --cwd packages/desktop tauri dev    # Run native desktop app
bun run --cwd packages/desktop tauri build  # Build desktop app bundle

# Web app
bun run --cwd packages/app dev              # Run web UI dev server
```

### SDK Generation

```bash
./script/generate.ts     # Regenerate JS SDK and related files after API changes
./packages/sdk/js/script/build.ts  # Regenerate JS SDK directly
```

## Architecture

### Core Packages

- **packages/opencode**: Main OpenCode server and CLI logic
  - `src/cli/`: CLI commands
  - `src/server/`: Hono-based API server
  - `src/session/`: Session management, message handling, LLM integration
  - `src/agent/`: Agent system and prompt management
  - `src/tool/`: Tool implementations (Bash, Edit, Read, Write, Grep, etc.)
  - `src/lsp/`: Language Server Protocol client/server
  - `src/mcp/`: Model Context Protocol integration
  - `src/skill/`: Skill system for extensibility
  - `src/project/`: Project detection and configuration
  - `src/provider/`: LLM provider integrations (Anthropic, OpenAI, etc.)

- **packages/app**: Shared web UI components (SolidJS)
  - Used by both web interface and desktop app
  - `src/components/`: Reusable UI components
  - `src/context/`: SolidJS contexts for state management
  - `src/pages/`: Page components

- **packages/desktop**: Native desktop app (Tauri + SolidJS)
  - Wraps `packages/app` in a native window
  - `src-tauri/`: Rust backend code

- **packages/sdk/js**: Generated TypeScript SDK from OpenAPI spec
  - Auto-generated from `packages/sdk/openapi.json`
  - Run `./script/generate.ts` after server API changes

- **packages/plugin**: Plugin API for extending OpenCode
  - Exports types and utilities for building plugins

- **packages/ui**: Shared UI primitives and components

- **packages/util**: Shared utility functions

### Additional Packages

- **packages/enterprise**: Enterprise features (storage, sharing)
- **packages/web**: Web landing page and marketing site
- **packages/docs**: Documentation site
- **packages/console**: Console UI packages (app, api, web)
- **packages/slack**: Slack integration
- **packages/function**: Serverless function utilities
- **packages/identity**: Authentication and identity management
- **sdks/vscode**: VS Code extension

### Client-Server Architecture

OpenCode uses a client-server model:

1. **Server** (`src/server/server.ts`): Hono-based HTTP/WebSocket API
2. **Web Client** (`packages/app`): Browser-based client
3. **Desktop Client** (`packages/desktop`): Native app wrapping web client

Clients connect to the server via HTTP API or attach to running sessions.

### Agent System

OpenCode has multiple agents defined in configuration:

- **build**: Default full-access agent for development work
- **plan**: Read-only agent for analysis (denies writes, asks permission for bash)
- **general**: Subagent for complex searches and multistep tasks (invoked via `@general`)

Agent prompts are in `src/session/prompt/` and `src/agent/prompt/`.

### Tool System

Tools are the primary interface between the agent and the codebase:

- Each tool has a `.ts` file (implementation) and `.txt` file (LLM description)
- Tools are registered in `src/tool/registry.ts`
- Key tools: Bash, Edit, Write, Read, Grep, Glob, LSP, Task, TodoWrite
- Tools support both synchronous and async permission checking

### Session Management

Sessions (`src/session/`) handle:

- Message processing and LLM streaming
- Context compaction (automatic summarization for unlimited context)
- Truncation strategies for managing token limits
- Retry and revert functionality
- Todo list management

### LSP Integration

OpenCode provides out-of-the-box LSP support:

- LSP servers configured per language in `src/lsp/server.ts`
- Client in `src/lsp/client.ts` manages server lifecycle
- Exposed via LSP tool for agents to use

### MCP Integration

Model Context Protocol support in `src/mcp/`:

- OAuth integration for authenticated MCP servers
- Server management and lifecycle
- Headers and authentication handling

## Code Style

Follow the style guide in `STYLE_GUIDE.md`:

- Keep logic in single functions unless composable/reusable
- Avoid unnecessary destructuring
- Prefer `.catch()` over `try`/`catch`
- Avoid `else` statements
- Avoid `any` type
- Avoid `let`, prefer immutable patterns
- Prefer single-word variable names
- Use Bun APIs (e.g., `Bun.file()`) where possible

## Testing

- Tests use Bun's built-in test runner
- Test files: `**/*.test.ts` in `packages/*/test/` directories
- Run tests from the specific package directory

## Infrastructure

- **SST** for infrastructure as code (`sst.config.ts`)
- **Cloudflare** as primary cloud provider
- **Turbo** for monorepo build orchestration

## Important Notes

- Always use parallel tool calls when operations are independent
- After modifying `packages/opencode/src/server/server.ts`, regenerate SDK
- Desktop app requires Rust toolchain and Tauri prerequisites
- Prettier config: no semicolons, 120 print width
- Package manager: Bun 1.3+
