# oagent Architecture Report

## 1. Executive Summary

The `oagent` project is a sophisticated monorepo designed to bridge AI agents, specifically OpenCode, with external interfaces like Claude Code and a custom web-based observability dashboard. It functions as a Model Context Protocol (MCP) server and an Agent Client Protocol (ACP) client. The architecture is split into four main packages: a lightweight CLI entry point (`apps/cli`), a reactive web single-page application (`apps/web`), a robust backend engine (`services/engine`), and shared development utilities (`packages/common`). The entire stack is built on Bun and TypeScript, with the backend heavily leveraging Effect-TS for functional, composable, and type-safe asynchronous operations. The system persists job states and agent output streams in an embedded SQLite database, ensuring durability and providing a historical record of all agent activities. A key design goal is the ability to run agents as background "jobs," monitor their progress in real-time via Server-Sent Events (SSE), and manage their lifecycle through a typed RPC interface.

## 2. Monorepo Structure and Technology Stack

The project is organized as a monorepo, which allows for clear separation of concerns while facilitating code sharing and coordinated builds. The workspace is defined at the root level, with packages linked via workspace protocols (`workspace:*`).

### 2.1. Workspace Packages

- **`apps/cli` (`@oagent/cli`)**: This package serves as the primary binary entry point for the application. It is responsible for parsing command-line arguments, initializing the correct runtime mode (e.g., serving the web UI, running as an MCP server over stdio, or bridging to Claude Code), and orchestrating the startup of the engine. It depends on the `engine` and `common` packages.
- **`apps/web` (`@oagent/web`)**: This is the user-facing observability dashboard. It is a modern React Single Page Application (SPA) built with Vite. It provides a real-time view into the jobs managed by the engine, allowing users to see agent output, tool calls, reasoning, and errors as they happen. It communicates with the engine via a typed oRPC client.
- **`services/engine` (`@oagent/engine`)**: The core of the `oagent` system. This package contains all the business logic for managing agent jobs, communicating with ACP backends (like OpenCode), persisting data, and serving the API. It is designed to be agnostic of the specific transport layer (MCP, HTTP) and is purely focused on the domain logic of running and monitoring agent tasks.
- **`packages/common` (`@oagent/common`)**: A shared library containing utility functions and abstractions used by other packages, primarily focused on the development workflow. It includes helpers for managing development sessions, running subprocesses, and handling inter-process communication signals.

### 2.2. Core Technologies

The project makes a deliberate and modern choice of technologies to achieve high performance, type safety, and a superior developer experience.

- **Bun**: Used as the JavaScript runtime and bundler. Its high-performance native APIs for HTTP serving, file system operations, and subprocess management make it an ideal choice for a tool that is both a server and a CLI. The build process leverages `Bun.build` with the `compile: true` option to produce a standalone, platform-specific binary, simplifying distribution.
- **TypeScript**: The entire codebase is written in TypeScript, providing end-to-end type safety from the database schema to the RPC API and the React UI components. This minimizes runtime errors and enhances code maintainability.
- **Effect-TS**: This is a foundational library for the `services/engine` and `apps/cli` packages. Effect-TS is a powerful functional effect system for TypeScript. It is used to manage complex asynchronous workflows, handle errors in a structured way (via `Effect` and `Exit`), manage resources (via `Scope` and `Layer`), and build highly composable services. The engine's core services like `Jobs`, `OpenCode`, and `Db` are all implemented as Effect services.
- **Drizzle ORM**: A lightweight, type-safe SQL-like ORM used for all database interactions in the engine. It is used to define the SQLite schema, perform migrations, and execute queries. Its "SQL-like" API fits well with the project's preference for explicit and predictable data access patterns.
- **SQLite**: The database of choice for the engine. It is embedded, requiring no separate server process, which aligns perfectly with the goal of a simple, standalone CLI tool. The project uses WAL (Write-Ahead Logging) mode for better concurrency and performance.
- **oRPC**: A type-safe RPC framework used for communication between the web UI and the engine. The engine defines a router with typed procedures, and the web client uses this router type to generate a fully typed client SDK, ensuring that API contracts are always in sync between the frontend and backend.
- **React 19 & Vite**: The web UI is built with the latest React features and Vite for an extremely fast development experience and optimized production builds.
- **Tailwind CSS v4**: Used for all styling in the web UI. The project uses a custom design system built on top of Tailwind's utility-first approach, with custom CSS variables for theming (light/dark mode).
- **Radix UI**: Provides the unstyled, accessible primitives for the UI components (dialogs, dropdowns, tooltips, etc.), ensuring a high level of accessibility and customizability.

## 3. The Engine (`services/engine`)

The `services/engine` package is the brain of `oagent`. It encapsulates all the logic for running agent jobs and exposing their state. It is built as a collection of composable Effect services and is designed to be embeddable or run standalone.

### 3.1. Core Services (Effect-TS)

The engine's functionality is decomposed into several key Effect services, each with a specific responsibility.

#### 3.1.1. `Jobs` Service

The `Jobs` service is the central orchestrator for all agent tasks. It is defined as an Effect `Tag`, which allows it to be provided as a layer throughout the application.
- **Responsibilities**:
  - **Job Lifecycle Management**: It handles the creation, execution, and termination of jobs. A "job" represents a single agent turn or session.
  - **Database Persistence**: It persists all job metadata and events to the SQLite database via the `Db` service. This ensures that the state of every job is durable and can be queried later.
  - **Event Fanout**: It manages an in-memory `EventEmitter` keyed by job ID. When a job produces a new event (e.g., a message chunk, a tool call), the `Jobs` service writes it to the database and then publishes it to the live event emitter, allowing SSE connections to push updates to clients in real-time.
  - **Waiting and Cancellation**: It provides a `wait` mechanism for other parts of the system to block until a job reaches a terminal state (`done` or `error`). It also handles job cancellation by interrupting the underlying Effect fiber.

#### 3.1.2. `OpenCode` Service

This service is the primary adapter for the OpenCode ACP backend. It wraps the logic for spawning and communicating with an OpenCode subprocess.
- **Responsibilities**:
  - **Subprocess Management**: It handles the lifecycle of the `opencode` binary, including spawning it with the correct arguments and environment variables.
  - **ACP Session**: It establishes and manages the ACP session over the subprocess's stdio. This involves sending initialization messages and then a stream of `SessionUpdate` objects representing the user's request.
  - **Turn Execution**: Its main function is `runTurn`, which takes a prompt and other parameters, sends them to the OpenCode process, and yields a stream of `SessionUpdate` events back to the caller (the `Jobs` service).
  - **Model Catalog**: The engine includes a `model-catalog.ts` which likely contains static or dynamically fetched information about available models to validate user requests.

#### 3.1.3. `Cursor`, `Grok`, and `Codex` Services

The architecture is designed to support multiple ACP backends. While the primary focus is on OpenCode, the codebase includes the scaffolding for `Cursor`, `Grok`, and `Codex` backends. These services follow the same pattern as the `OpenCode` service: wrapping a subprocess or API client, and yielding a stream of normalized events. The existence of these files indicates a future-proof design that can easily be extended to support other agent providers.

#### 3.1.4. `Db` Service

The `Db` service provides a scoped, managed interface to the SQLite database.
- **Responsibilities**:
  - **Connection Management**: It opens the SQLite database file (located at `~/.config/oagent/sqlite.db`) with specific pragmas like `WAL` mode, `foreign_keys`, and `busy_timeout` to ensure reliability and performance.
  - **Lifecycle Management**: Using Effect's `Scope`, it ensures that the database connection is properly closed when the service is no longer needed.
  - **Migration Execution**: On startup, it runs the embedded migration runner (`migrate.ts`) to ensure the database schema is up to date. It also performs "orphan recovery," marking any jobs that were in a `running` state at shutdown as `error`, preventing them from being stuck in limbo.

### 3.2. Database Layer (`db/`)

The persistence layer is implemented using Drizzle ORM with an embedded SQLite database. The design is robust, handling schema versioning and complex event modeling.

#### 3.2.1. Schema (`schema.ts`)

The schema is the source of truth for the database structure.
- **`jobs` Table**: This is the central table for job metadata. It uses a UUIDv7 for its public-facing ID and an internal auto-incrementing integer as its primary key for efficient indexing. Key columns include `status` (`running`, `done`, `error`), `prompt`, `cwd` (current working directory), `created_at`, and `terminated_at`.
- **`events` Table**: This is the base table for all events emitted during a job's execution. It uses a polymorphic pattern where each row has a `session_update` discriminator column. This allows the engine to store all 11 different variants of `SessionUpdate` in a structured way.
- **Variant Tables**: For event types that have a complex structure (like tool calls, reasoning, or message chunks), the schema includes separate tables (e.g., `chunk_events`, `tool_call_events`, `plan_events`). These tables have foreign keys back to the main `events` table and decompose the nested JSON structure into typed columns where possible, while keeping opaque or highly variable fields as JSON.
- **`model_aliases` Table**: This table is used for the model aliasing feature in the web UI. It allows users to create short, memorable names (aliases) for specific `backend + model_id` combinations. This makes it easier to switch between models without having to remember their full identifiers.

#### 3.2.2. Migrations (`migrate.ts`)

The migration system is custom-built to support the embedded nature of the application.
- **Embedded SQL**: Instead of relying on a separate migration tool like `drizzle-kit` at runtime, the engine embeds the SQL for all migrations directly into the source code. This is achieved by importing `.sql` files with the `type: 'text'` assertion, which inlines their content as strings.
- **Runner**: The `migrate.ts` script implements a lightweight migration runner. It creates a `__drizzle_migrations` table to track which migrations have been applied. On startup, it reads the list of embedded migration files, checks the tracking table, and executes any pending migrations in a transaction.
- **Generation**: A development script, `scripts/gen-migrations.ts`, is used to generate the `.gen/migrations.gen.ts` file, which collects all the SQL files and exports them as an array that the runner can consume. This ensures the build process captures all schema changes.

#### 3.2.3. Event Assembly (`assembleEvent.ts`)

Given the polymorphic nature of the event schema, a utility is needed to reconstruct a full event object from its base and variant table rows. `assembleEvent.ts` provides this logic. When querying the history of events for a job, the `Db` service reads from the `events` table and then, based on the `session_update` discriminator, joins with the appropriate variant table. The `assembleEvent` function then takes these raw database rows and merges them back into a single, coherent `SessionUpdate` object, restoring the structure that was present in the original ACP stream.

### 3.3. HTTP and RPC Layer

The engine exposes its functionality over HTTP, making it accessible to the web UI and the CLI's various modes.

#### 3.3.1. Server (`server.ts`)

The `createServer` function is the main entry point for the HTTP server.
- **Bun.serve**: It uses `Bun.serve` to create a high-performance HTTP server.
- **Route Dispatching**: The server defines a clear order of routes:
  1. `/mcp`: Handles MCP transport over WebStandard streams.
  2. `/rpc/*`: Delegates to the oRPC router for all RPC calls.
  3. `/jobs/:id/events`: Handles raw Server-Sent Event (SSE) connections for live job updates.
  4. `/jobs/:id/wait`: Provides a long-polling endpoint to wait for a job to finish.
  5. SPA Fallback: If a `filemap` is provided (from the embedded web UI), any unmatched route falls back to serving the SPA's `index.html`, enabling client-side routing.
- **Port Management**: The server defaults to port 17777. If that port is in use (e.g., by another `oagent` instance), it gracefully falls back to port 0, letting the OS assign an available port.

#### 3.3.2. oRPC Router (`rpc/router.ts`)

The RPC layer is built with `@orpc/server` and `ff-effect/for/orpc`, providing a seamless integration with Effect-TS.
- **Typed Procedures**: The router defines procedures for job management (`jobs.list`, `jobs.get`, `jobs.start`, `jobs.wait`) and model management (`models.list`).
- **Explicit Output Schemas**: A critical design choice is the explicit declaration of output schemas using Valibot. The documentation notes that without `.output(...)`, TypeScript's inference can collapse complex generic return types to `unknown`. By being explicit, the router maintains full end-to-end type safety.
- **`EngineRouter` Type**: The router file exports a type `EngineRouter` which is the inferred type of the router itself. This type is imported by the web UI's client (`apps/web/src/lib/orpc.ts`) to generate a fully typed client, guaranteeing that the frontend and backend are always in sync.

#### 3.3.3. HTTP Handlers (`http/`)

The server delegates specific endpoint logic to dedicated handler modules.
- **`sse.ts`**: This module handles Server-Sent Events. When a client connects to `/jobs/:id/events`, it first queries the `Db` service to get the historical events for that job and sends them down the wire. Then, it subscribes to the live `EventEmitter` managed by the `Jobs` service. It carefully manages the "buffer-then-drain" race condition to ensure no events are lost between reading history and attaching to the live stream. When the job finishes, it sends a `__terminal__` sentinel to tell the client the stream is complete.
- **`wait.ts`**: This module implements a long-polling endpoint at `/jobs/:id/wait`. It calls `Jobs.wait` and blocks until the job is no longer `running`. Once the job is `done` or `error`, it returns the final result as a JSON response.
- **`spa.ts`**: This module handles serving the static assets of the web UI. It receives a `filemap` (generated at build time) which maps file paths to their contents. It serves these files with appropriate MIME types and handles the `index.html` fallback for single-page application routing.

### 3.4. MCP Integration (`mcp/`)

The engine is also an MCP server, allowing it to be controlled by MCP clients like Claude Desktop or the `stdio` CLI mode.
- **`register-tools.ts`**: This is the entry point for MCP tool registration. It defines the server's capabilities and registers all available tools.
- **Tools**: The MCP server exposes three primary tools:
  - `start`: Initiates a new agent job with a given prompt. It calls `Jobs.start` and returns the new `jobId`.
  - `result`: Retrieves the final result of a completed or errored job.
  - `cancel`: Sends a cancellation signal to a running job.

## 4. The CLI (`apps/cli`)

The CLI is the user-facing executable that brings all the engine's capabilities together. It is built with `@effect/cli` and provides several distinct modes of operation.

### 4.1. Entry Point (`index.ts`)

The main entry point defines the top-level `oagent` command and its subcommands. A crucial design decision is noted in the comments: the root CLI program only provides the `BunContext` layer. Each individual subcommand is responsible for providing the `Engine.layer` itself. This is a deliberate architectural choice to prevent the `claude mcp serve` command from inadvertently initializing the `Engine.layer` (and thus the database) when it is intended to be a lightweight bridge to an already-running engine.

### 4.2. Subcommands

#### 4.2.1. `serve`

The `serve` subcommand is used to run a standalone engine server with the web UI embedded. It loads the pre-built SPA filemap from `.gen/web-ui.gen.ts` and passes it to the engine's `createServer`. This mode is useful for running a persistent `oagent` instance that can be accessed via a browser.

#### 4.2.2. `stdio`

The `stdio` subcommand runs `oagent` as a local MCP server over standard input/output. It initializes the engine in-process and registers the MCP tools. This mode is typically used by applications like Claude Desktop to integrate `oagent` as a tool provider.

#### 4.2.3. `claude mcp serve`

This is a specialized subcommand designed for the Claude Code editor integration. Unlike the standard `stdio` mode, it does **not** run jobs in-process. Instead, it acts as a thin client to a running engine instance.
- **Bridge Architecture**: It creates a `Claude Code channel` over stdio. When it receives a request to start a job, it immediately forks the job on the remote engine (specified by `--engine-url`, defaulting to `http://localhost:17777`) and returns the `jobId`.
- **Fire-and-Forget Waiter**: It then starts a background "waiter" process. This waiter subscribes to the engine's SSE event stream for that job. When it sees the `__terminal__` sentinel, it fetches the final result via the `jobs.wait` RPC call.
- **Channel Event**: Finally, it pushes the complete result back into the Claude Code session as a `notifications/claude/channel` event. This rich event format allows Claude Code to render the agent's output natively within the chat interface.
- **No Orphan Recovery**: Because it doesn't run the engine itself, it avoids the problem of orphan recovery, where a new, short-lived engine instance would incorrectly mark the long-lived engine's running jobs as errored.

#### 4.2.4. `jobs`

This subcommand provides a command-line interface for managing jobs. It can list running and completed jobs, show details, and potentially cancel them. This is useful for users who prefer terminal-based workflows or need to script job management.

#### 4.2.5. `doctor`

The `doctor` subcommand is a diagnostic tool. It checks the environment for common issues, such as whether the `opencode` binary is in the system's PATH, if the database is accessible, and if the default port is available. It provides helpful messages to guide the user in fixing any problems it finds.

### 4.3. Build Pipeline (`scripts/build.ts`)

The build process for the CLI is unique because it must embed the web UI into the final binary.
1. **Build Web UI**: The script first runs `vite build` in the `apps/web` directory to generate the production-ready static assets in `apps/web/dist/`.
2. **Generate Filemap**: It then walks the `dist/` directory and generates a TypeScript file at `apps/cli/.gen/web-ui.gen.ts`. This file contains a default-exported object (a filemap) where keys are file paths (e.g., `/index.html`, `/assets/main.js`) and values are `import` statements using `with { type: 'file' }`. This tells Bun's bundler to embed the actual file contents into the binary.
3. **Compile Binary**: Finally, it runs `Bun.build({ compile: true, ... })`, specifying both the CLI's entry point and the generated filemap module as entrypoints. Bun's compiler then produces a single, self-contained executable that includes the Node.js runtime, the application code, and all the web UI assets.

## 5. The Web SPA (`apps/web`)

The web application is a sophisticated dashboard for observing and managing `oagent` jobs. It is designed to be a real-time, interactive experience.

### 5.1. Architecture and Routing

The SPA is built with a modern stack focused on performance and developer experience.
- **Vite**: The build tool, providing fast HMR (Hot Module Replacement) and optimized production builds.
- **TanStack Router**: Used for client-side routing. The router is defined in `router.ts` and has a simple structure: a console layout for the main job view and a settings layout for configuration. The router definition is fully typed, preventing broken links and invalid parameters.
- **TanStack Query**: Manages server state. It handles caching, background refetching, and mutations for all API calls to the engine. The `queryClient` is initialized in `lib/query.ts`.
- **oRPC Client**: The `lib/orpc.ts` file creates a typed oRPC client. In development, it proxies requests to the engine. In production (when served from the embedded CLI), it calls the same-origin server. A `?engine=` query parameter can be used to override the engine URL.

### 5.2. Core Pages and Layouts

- **`ConsoleLayout`**: This is the main layout for the application. It features a sidebar on the left containing the list of jobs and a main content area on the right. It uses the `useJobList` hook to populate the sidebar.
- **`ConsoleIndexPage`**: The default view when no job is selected. It displays an empty state, prompting the user to select a job from the sidebar.
- **`JobDetailPage`**: This is the most critical page. It is parameterized by `jobId`. It fetches the details of a specific job and, more importantly, subscribes to its event stream. It renders the `JobHeader` (with status, prompt, and controls) and the `JobTimeline`.
- **`SettingsLayout`**: A simple layout for the settings section.
- **`AliasesPage`**: A page within the settings section for managing model aliases. It provides a form to create and edit aliases, selecting a backend and a model from a searchable combobox.

### 5.3. Job Observability Components

The core value of the web UI is its ability to render the complex output of an AI agent in a human-readable format.

#### 5.3.1. `JobTimeline`

This is the centerpiece of the job detail page. It takes the array of `TimelinePart` objects (produced by the `event-adapter`) and renders them. To handle potentially very long agent outputs efficiently, it uses `@tanstack/react-virtual`. This means only the visible items are rendered in the DOM, ensuring smooth scrolling even for jobs with thousands of events. It also includes a "scroll to bottom" button that appears when the user scrolls up, allowing them to easily return to the latest output.

#### 5.3.2. `JobHeader`

This component displays the high-level metadata for a job. It shows the job ID, its current status (with a colored dot), the initial prompt, the working directory, the model used, and the elapsed time. If the job is running, it shows a "Cancel" button. It also allows the user to copy the job ID to the clipboard.

#### 5.3.3. `JobSidebar`

Located in the `ConsoleLayout`, this component lists all jobs. It groups them by day ("Today", "Yesterday", etc.) and displays a preview of the prompt and the job's status. It includes a search/filter input to narrow down the list by working directory. Hovering over a job in the sidebar triggers a "warmup" effect, which preemptively opens an SSE connection to that job so that if the user clicks on it, the events will already be streaming.

### 5.4. Event Adaptation (`lib/event-adapter.ts`)

The raw stream of `SessionUpdate` events from the ACP backend is a flat, chronological list. The `event-adapter.ts` module is responsible for transforming this flat stream into a structured `TimelinePart[]` array that the UI can render.
- **State Machine**: It implements a reducer-like state machine. It maintains an internal state with "open" text and reasoning blocks. As chunk events (`agent_message_chunk`, `agent_thought_chunk`) arrive, it appends their content to the open blocks. When a non-chunk event arrives, it "flushes" the open blocks into final `TimelinePart` objects.
- **Tool Call Normalization**: It handles the complex lifecycle of tool calls. ACP events for tool calls can be fragmented and arrive out of order. The adapter normalizes these into `ToolCall` parts with a clear state (`input-streaming`, `input-available`, `output-available`, `output-error`).
- **Streaming Tail**: It distinguishes between finalized `parts` and a `streamingTail`. The `streamingTail` represents the currently open text or reasoning block that is still being updated by the agent. This allows the UI to render the final, stable parts with heavy components (like syntax highlighting) while keeping the streaming tail lightweight for frequent updates.

### 5.5. `ai-elements` Component Library

The `apps/web/src/components/ai-elements/` directory contains a rich library of components designed to render specific types of AI output. This is not just a generic UI kit; it's a specialized set of components for agent observability.
- **`conversation.tsx`**: Provides the virtualized list container for the timeline.
- **`message.tsx`**: Renders standard text messages, using `streamdown` for rich markdown rendering with plugins for math, code, and Mermaid diagrams.
- **`reasoning.tsx`**: Renders reasoning/thinking blocks in a collapsible UI. It auto-opens when streaming and auto-closes when finished, showing the duration of the thought process.
- **`tool.tsx`**: Renders tool invocations. It shows the tool name, its status (with an animated icon), and its arguments. When expanded, it shows the input and output, with special rendering for diffs and terminal output.
- **`code-block.tsx`**: A high-performance code block component using `shiki` for syntax highlighting. It features a sophisticated caching and async loading mechanism to prevent jank during streaming. It also includes a copy-to-clipboard button.
- **`terminal.tsx`**: A dedicated component for rendering terminal output, preserving ANSI color codes.
- **`sandbox.tsx`**: A component for rendering code sandbox previews, with tabs for different files and a console output view.
- **`commit.tsx`**: A component styled like a Git commit, showing file changes with additions and deletions.
- **`test-results.tsx`**: Renders the output of test suites, showing passed, failed, and skipped tests with a progress bar.
- **`agent.tsx`**: A component for displaying meta-information about an agent, like its instructions and available tools.
- **`persona.tsx`**: A highly specialized component that uses Rive animations to display an animated avatar that reacts to the agent's state (idle, listening, thinking, speaking).

### 5.6. UI Primitives (`components/ui/`)

The `components/ui/` directory contains the base design system components, largely following the `shadcn/ui` pattern but customized for the project's aesthetic. These are built on top of Radix UI primitives and styled with Tailwind CSS. Examples include `button`, `dialog`, `select`, `tooltip`, `badge`, `card`, `command` (for command palettes), and `carousel`. These components use `data-slot` attributes for styling hooks and `cn()` (from `tailwind-merge` and `clsx`) for conditional class merging.

## 6. Development Utilities (`packages/common`)

This package provides shared infrastructure for the development workflow, particularly for managing the multiple processes involved in a monorepo.

### 6.1. `DevSessions`

The `DevSessions` service manages temporary development sessions. When running in dev mode, the engine and web server need to coordinate on things like port numbers. This service creates a unique session directory (using a random noun slug) inside `.data/sessions`. It provides an API to get the latest session or create a new one, allowing dev processes to persist state across restarts.

### 6.2. `defineDevCli`

This is a helper function used by the dev scripts of both the engine and the web app. It wraps `@effect/cli` to create a CLI that can manage a dev session, get a sticky port, run managed subprocesses, and publish/await "running signals." This allows, for example, the engine's dev script to publish its URL to a file, and the web's dev script to wait for that file to appear before starting its proxy.

### 6.3. `running-signal.ts`

This module implements a simple but robust inter-process communication mechanism. A process can "publish" a running signal by atomically writing a JSON file to a known location. Another process can "await" that signal by watching the parent directory for file creation events and then parsing the file. This is used to handle the startup race condition between the engine and the web dev server.

## 7. Data Flow and Key Interactions

Understanding the flow of a typical request illuminates how the different parts of the system work together.

### 7.1. Starting a Job (via MCP)
1. An MCP client (like Claude Desktop) sends a `tools/call` request for the `start` tool.
2. The CLI's `stdio` command receives this request. It provides the `Engine.layer`, which spins up the `Jobs`, `OpenCode`, and `Db` services.
3. The MCP handler in the engine calls `Jobs.start(prompt, options)`.
4. The `Jobs` service creates a new job record in the SQLite database with status `running`.
5. It then forks an Effect fiber that runs `OpenCode.runTurn(prompt, options)`.
6. The `OpenCode` service spawns the `opencode` subprocess and begins streaming `SessionUpdate` events.
7. As events arrive, the `Jobs` service writes them to the `events` table in SQLite and publishes them to the in-memory `EventEmitter`.
8. The `start` tool handler returns the new `jobId` to the MCP client.

### 7.2. Observing a Job (via Web UI)
1. A user opens the web UI and clicks on the newly created job in the sidebar.
2. The `JobDetailPage` component mounts. It initiates an SSE connection to `/jobs/{jobId}/events`.
3. The engine's `sse.ts` handler receives the request. It queries the `Db` service for all historical events for that job and streams them to the client.
4. Once the history is sent, it subscribes to the live `EventEmitter` for that job ID. Any new events published by the `Jobs` service are immediately streamed to the client.
5. The client's `useJobEvents` hook receives these events and passes them through the `event-adapter.ts` reducer.
6. The reducer updates the `TimelinePart[]` state, which triggers a re-render of the `JobTimeline` component.
7. The timeline's virtualizer efficiently updates the DOM to show the new events. If the new event is a text chunk, it updates the `streamingTail`, providing a smooth visual effect.
8. When the job finishes, the `OpenCode` service closes the stream. The `Jobs` service updates the job status in the database to `done` or `error` and publishes the `__terminal__` sentinel.
9. The SSE handler sees the sentinel, sends it to the client, and closes the connection. The UI updates the job status in the header to reflect its final state.

### 7.3. The `claude mcp serve` Bridge
1. Claude Code starts the `oagent claude mcp serve` process.
2. The user asks Claude to perform a task using the `oagent` tool.
3. The `claude.ts` command handler receives the tool call. It does **not** have an in-process `Engine.layer`.
4. It creates an oRPC client pointing to the engine URL (e.g., `http://localhost:17777`).
5. It calls `jobs.start` via the oRPC client. The engine creates the job and begins execution as described above.
6. The handler immediately returns the `jobId` to Claude Code.
7. In the background, the handler's "waiter" logic starts. It opens an SSE connection to the engine's `/jobs/{jobId}/events` endpoint.
8. It consumes the event stream, buffering the events.
9. When it receives the `__terminal__` sentinel, it makes a final `jobs.wait` RPC call to get the conclusive result.
10. It formats this result into a `notifications/claude/channel` event and pushes it back to Claude Code over the stdio transport.
11. Claude Code receives this rich event and renders the agent's complete output in the chat.

## 8. Conclusion

The `oagent` project represents a well-architected, modern approach to building agentic tooling. Its monorepo structure cleanly separates concerns between the CLI, the web UI, and the core engine. The heavy use of TypeScript and Effect-TS on the backend ensures that complex asynchronous workflows are handled in a type-safe, composable, and robust manner. The choice of embedded SQLite and a self-compiling Bun binary makes the tool extremely portable and easy to distribute, while the rich React-based web UI provides a best-in-class observability experience. The design is forward-looking, with clear extension points for new ACP backends and MCP capabilities. The attention to detail in areas like database migrations, event normalization, and virtualized rendering demonstrates a commitment to both correctness and performance.