# mcp-kb-fs

[![CI](https://github.com/knowledgeislands/mcp-kb-fs/actions/workflows/ci.yml/badge.svg)](https://github.com/knowledgeislands/mcp-kb-fs/actions/workflows/ci.yml) [![npm version](https://img.shields.io/npm/v/@knowledgeislands/mcp-kb-fs.svg)](https://www.npmjs.com/package/@knowledgeislands/mcp-kb-fs) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

An MCP (Model Context Protocol) server that gives Claude read and write access to one or more local knowledge-base directories. Each call names the knowledge base it acts in by alias, and every file path is validated against that base's root, so the server cannot read or write outside it — even if asked to.

## Features

- **Many knowledge bases, one registration** — the environment declares alias → path pairs; every tool takes a required `kb` alias. One server process replaces one registration per base, and one tool surface replaces one per base in the client's tool list.
- **Read-only-by-default tools** — list and read are flagged as read-only and idempotent via MCP tool annotations.
- **Path safety in two layers** — lexical normalisation (rejects `..` and absolute-style escapes) plus a `realpath` check (rejects symlinks pointing outside the root). With several bases declared, this is also what stops a path under one alias reaching into a sibling base.
- **Protected paths** — dotfiles/dotdirs at any depth (`.git`, `.obsidian`, …) and root-level repo-meta (`README.md`, `CLAUDE.md`, `LICENSE`, …) stay hidden from ordinary tools; a separate exact allow-list permits read-only access to selected repository context files.
- **One content surface** — the same read, list, write, rename, and delete tools handle Markdown notes and side files; Markdown frontmatter/body selection remains available when reading `.md` files.
- **No network, no auth** — pure local filesystem over MCP stdio.

**Quality:** 289 tests at 100% coverage across statements, branches, functions, and lines.

## Available Tools

Tools follow the convention `<app>_<resource>_<action>`. Each tool declares an annotation preset (`READ_ONLY`, `WRITE`, `WRITE_IDEMPOTENT`, `DESTRUCTIVE`) which determines its access level (`read`, `write`, or `destructive`) via the underlying MCP hints (`readOnlyHint` / `destructiveHint`). The registered surface is controlled by the `MCP_KI_KB_FS_ACCESS_LEVEL` env var (defaults to `read`; levels nest). Tools above the configured level are silently skipped at registration.

| Tool               | Level         | Preset             | Description                                         |
| ------------------ | ------------- | ------------------ | --------------------------------------------------- |
| `kb_config`        | `read`        | `READ_ONLY`        | Return resolved zones, allow-list, and base roster. |
| `kb_read`          | `read`        | `READ_ONLY`        | Read text, binary, or a Markdown slice. †           |
| `kb_list`          | `read`        | `READ_ONLY`        | List files, folders, or Markdown notes.             |
| `kb_rename`        | `write`       | `WRITE`            | Rename/move a file. Refuses to overwrite. ‡         |
| `kb_folder_create` | `write`       | `WRITE_IDEMPOTENT` | Create a folder; idempotent. §                      |
| `kb_write`         | `destructive` | `DESTRUCTIVE`      | Write or overwrite text or binary content. ¶        |
| `kb_delete`        | `destructive` | `DESTRUCTIVE`      | Delete a file. `dry_run` defaults to `true`. ‖      |

† Zone/staging-root paths are readable; exact `root_file_allowlist` entries are also readable, but never writable or listable. Markdown accepts `part: "all" | "frontmatter" | "body"`. ‡ Non-idempotent: a second call with the same source fails because it has moved. § Succeeds when the folder already exists. ¶ Accepts UTF-8 or base64 and optionally creates parents; `dry_run` defaults to `true`. ‖ Pass `dry_run: false` to actually unlink.

### The `kb` argument

Every tool in the table above takes a required `kb` argument naming which declared knowledge base the call acts in:

```json
{
  "name": "kb_read",
  "arguments": { "kb": "kit-pkb", "path": "Pillars/Finance/Budget.md" }
}
```

The value must be one of the aliases in [`MCP_KI_KB_FS_KNOWLEDGE_BASES`](#environment-variables); each tool advertises the permitted set as an enum in its input schema, so an undeclared alias is refused during argument validation, before any filesystem access. `kb_config` returns the full roster, so a client can discover the aliases without being told the environment.

There is deliberately no default base and no ambient "current" base. A call that meant one base but omitted the argument would otherwise act silently on another — and at `destructive` access level that means writing to the wrong knowledge base. Aliases rather than paths keep the caller's contract stable: a base can be moved on disk by editing the declaration, with nothing the caller sends changing.

Each call acts within exactly one base. There are no cross-base operations: reading, writing, or moving content between two knowledge bases in a single call is not supported.

### `kb_read`

```json
{
  "name": "kb_read",
  "arguments": { "kb": "kit-pkb", "path": "Pillars/Finance/Budget.md", "part": "body" }
}
```

Returns JSON with the file path, MIME type, encoding, byte size, and content. UTF-8 files return text; binary files return base64. `part` is valid only for UTF-8 Markdown.

`kb_read` accepts ordinary files below a declared zone or staging root, plus exact configured context paths. The default root-file allow-list is `README.md`, `AGENTS.md`, and `CLAUDE.md`.

Configure a different exact list in the KB root’s `.ki.toml`:

```toml
[knowledgeislands-kb]
root_file_allowlist = ["README.md", "AGENTS.md", "CLAUDE.md", ".github/copilot-instructions.md"]
```

Every entry must be a non-empty KB-relative path with forward slashes; absolute paths, traversal segments, backslashes, and empty path segments are rejected at startup.

### `kb_list`

```json
{
  "name": "kb_list",
  "arguments": { "kb": "kit-pkb", "path": "Pillars", "kind": "notes", "recursive": true }
}
```

`path` must be a declared zone or staging-root directory. `kind` is `files` (default), `folders`, or `notes`; `ext` is available only with `kind: "files"`. The KB root and root-file allow-list are never listable.

### `kb_write`

```json
{
  "name": "kb_write",
  "arguments": {
    "kb": "kit-pkb",
    "path": "Inbox/2026-04-30.md",
    "content": "# Notes\n\n- ...",
    "create_dirs": true
  }
}
```

`encoding` is `utf-8` (default) or `base64`. `create_dirs` and `dry_run` default to `true`. The operation is limited to declared zones and staging roots.

### `kb_rename`

```json
{
  "name": "kb_rename",
  "arguments": {
    "kb": "kit-pkb",
    "from": "Inbox/draft.md",
    "to": "Pillars/Finance/Budget.md",
    "create_dirs": true
  }
}
```

Non-destructive: refuses to overwrite an existing destination. Both paths must be within declared zones or staging roots and pass the standard root/protected guards.

### `kb_folder_create`

```json
{
  "name": "kb_folder_create",
  "arguments": { "kb": "kit-pkb", "path": "Pillars/Finance/2026" }
}
```

`mkdir -p` semantics: creates intermediate folders as needed and is idempotent (re-running succeeds with `Folder already exists: "<path>"`). Fails with `Path exists as a file, not a folder` if a regular file already occupies the path. No `dry_run` — it's non-destructive.

### `kb_delete`

```json
{
  "name": "kb_delete",
  "arguments": { "kb": "kit-pkb", "path": "Inbox/2026-04-30.md", "dry_run": false }
}
```

`dry_run` defaults to `true`; pass `dry_run: false` to actually unlink. Root-file allow-list entries are never deletable.

## Quick Start

1. **Install dependencies**: `bun install`
2. **Pick a knowledge base directory** — any folder of notes and side files (can be empty).
3. **Build**: `bun run build`
4. **Configure Claude Desktop** with the path to `dist/mcp-server/index.js` and your `MCP_KI_KB_FS_KNOWLEDGE_BASES` declaration (see [Configuration](#configuration)).
5. **Restart Claude Desktop** — the enabled `kb_*` tools should appear (defaults to read-only).

## Example Conversations

Concrete asks you might make of Claude with this server connected.

**Survey a section of the KB:**

> "List every note under `Pillars/Finance`, recursively."

Claude calls [`kb_list`](#kb_list) with `path: "Pillars/Finance", kind: "notes", recursive: true` and returns the KB-relative Markdown paths. Folders are excluded.

**Read a specific note:**

> "Show me my Budget.md note from `Pillars/Finance`."

Claude calls [`kb_read`](#kb_read) with the KB-relative path. It can return the full file or the Markdown body/frontmatter; traversal and protected paths are rejected unless the path is an exact read-only root-file allow-list entry.

**Capture meeting notes:**

> "Save these notes as today's daily under `Inbox/2026-05-13.md` — create the Inbox folder if it doesn't exist yet."

Claude calls [`kb_write`](#kb_write) with UTF-8 Markdown content and `create_dirs: true` (the default). The path goes through both the lexical and `realpath` safety checks before any byte is written. `kb_write` is annotated `DESTRUCTIVE` (it can overwrite an existing file), so `MCP_KI_KB_FS_ACCESS_LEVEL=destructive` is required for it to register.

**Discover structure:**

> "What top-level folders exist in my knowledge base?"

Claude calls [`kb_list`](#kb_list) with `path: "Pillars", kind: "folders", recursive: false`. The root itself is deliberately not listable.

## Installation

### Prerequisites

- [Bun](https://bun.sh) 1.3+ for the dev loop
- Node.js 24.15.0 or higher to run the compiled `dist/` (see `mise.toml`)

### Install Dependencies

```bash
bun install
```

## Configuration

### Environment Variables

| Name | Required | Description |
| --- | --- | --- |
| `MCP_KI_KB_FS_KNOWLEDGE_BASES` | yes | JSON object mapping knowledge-base alias to path. ★ |
| `MCP_KI_KB_FS_ACCESS_LEVEL` | no | Maximum tool access level to register. † |
| `MCP_KI_KB_FS_AUDIT_LOG` | no | Audit-log scope. ‡ |
| `MCP_KI_KB_FS_AUDIT_LOG_PATH` | no | Path to the JSONL audit log. Default `~/.local/state/mcp-kb-fs/audit.jsonl`. |
| `MCP_KI_KB_FS_AUDIT_LOG_MAX_BYTES` | no | Size-based rotation threshold in bytes. ¶ |
| `MCP_KI_KB_FS_AUDIT_LOG_KEEP` | no | Number of rotated audit-log files to retain. Default `5`. |
| `NODE_ENV` | no | Dev convention; controls which `.env` files `loadConfig()` picks up. § |

★ The knowledge bases this install may reach, as a JSON object mapping each caller-facing alias to that base's absolute (or `~/...`) path:

```jsonc
{ "kit-pkb": "~/kb/kit-pkb", "kit-legal": "/srv/kb/legal" }
```

Every tool takes a required `kb` argument whose value must be one of these aliases — see [The `kb` argument](#the-kb-argument). This declaration is the install's authorisation boundary, so it is validated in full at startup rather than on first use: invalid JSON, a value that is not a string, a repeated alias, an alias that is not a safe identifier (leading letter or digit, then letters, digits, `.`, `-`, `_`, max 64 characters), an empty declaration, a relative path, or a path that is not an existing directory each abort the server. Access level is server-wide and composes with this: the declaration bounds _which_ bases the registration may reach, `MCP_KI_KB_FS_ACCESS_LEVEL` bounds _what_ may be done in them. There is no `MCP_KI_KB_FS_ROOT_PATH` fallback — a single-base install declares one alias.

† Maximum tool access level to register. One of: `read` (default — read-only tools only, least privilege), `write` (adds non-destructive mutations: `kb_rename`, `kb_folder_create`), `destructive` (adds overwrite/delete: `kb_write`, `kb_delete`). Levels nest. Each tool's level is derived from its MCP annotations (`readOnlyHint: true` → `read`; `destructiveHint: true` → `destructive`; explicit `readOnlyHint: false` AND `destructiveHint: false` → `write`; missing annotations → `destructive` fail-safe); a tool registers when its derived level ≤ the configured level. The `dry_run: true` default on destructive tools controls _effect_; this gate controls _visibility_. An unknown value aborts startup.

‡ Audit-log scope. One of `off`, `writes` (default — record only non-read tool calls), `all` (record every invocation).

¶ Size-based rotation threshold in bytes. Default `10485760` (10 MiB). Set to `0` to disable rotation.

§ Dev convention. `loadConfig()` in [`src/config/index.ts`](./src/config/index.ts) hydrates `process.env`, from the package root and highest precedence first, from `.env.local`, then `.env.${NODE_ENV}` (when set), then `.env`; a var already in the environment (e.g. the MCP client's `env` block) always wins. `ki:server:mcp:dev`/`ki:server:mcp:inspect` set this to `development` so `.env.development` is picked up; under Claude Desktop it is unset, so only `.env.local`/`.env` would apply.

### Claude Desktop Configuration

Run `bun run build` first so `dist/mcp-server/index.js` exists, then add to your Claude Desktop config:

```json
{
  "mcpServers": {
    "mcp-kb-fs": {
      "command": "node",
      "args": ["/path/to/mcp-kb-fs/dist/mcp-server/index.js"],
      "env": {
        "MCP_KI_KB_FS_KNOWLEDGE_BASES": "{\"kit-pkb\":\"/path/to/your/kb\",\"kit-legal\":\"/path/to/another/kb\"}"
      }
    }
  }
}
```

A starter is in [`claude-config-sample.json`](./claude-config-sample.json).

### Running From Source (Dev)

For fast iteration without rebuilding:

```bash
MCP_KI_KB_FS_KNOWLEDGE_BASES='{"notes":"~/notes"}' bun run ki:server:mcp:dev
```

This runs `src/mcp-server/index.ts` under `bun --watch`. Point Claude Desktop at this command during development if you want live reload.

Alternatively, copy [`.env.example`](./.env.example) to `.env.development` (or `.env.local`) and set `MCP_KI_KB_FS_KNOWLEDGE_BASES` there. At startup `loadConfig()` in [`src/config/index.ts`](./src/config/index.ts) hydrates `process.env` from the package root, highest precedence first: `.env.local`, then `.env.${NODE_ENV}` (when set), then `.env`. The `ki:server:mcp:dev`/`ki:server:mcp:inspect` scripts run with `NODE_ENV=development`, so `.env.development` is picked up; Claude Desktop does not set `NODE_ENV`, so only `.env.local`/`.env` would apply. A var already present in the environment (e.g. the Desktop config `env` block) always beats any file.

## Development

```bash
bun run ki:server:mcp:dev      # bun --watch mode (NODE_ENV=development)
bun run ki:server:mcp:start    # build then run from dist/ under node
bun run ki:server:mcp:inspect  # MCP Inspector against TS source (NODE_ENV=development)
bun run test                # vitest (use `bun run test`, not `bun test`)
bun run ki:lint:types          # tsc --noEmit
bun run ki:lint:check          # Biome lint + format check
bun run ki:lint:fix            # Biome auto-fix (uses --unsafe)
ki repo audit --skill ki-authoring --repo .  # rumdl check for authored Markdown
```

## Security Model

- **The declaration is the authorisation boundary.** `loadConfig()` resolves `MCP_KI_KB_FS_KNOWLEDGE_BASES` at startup into one `KnowledgeBase` per alias — root, zone map and root-file allow-list travelling together as one closed bundle — and refuses to start unless every declared path is an existing directory. `~` is expanded to the user home directory; relative paths are rejected so the boundary never depends on the launch directory. An alias that is not declared is unreachable, and no tool argument can introduce a path: `kb` selects among declared aliases and nothing else.
- **One base per call.** Each handler turns its `kb` alias into a base through the single `selectKnowledgeBase()` helper and passes that base — never the whole config — into `src/main/`. Implementation functions cannot see a second base's root, so a path can only ever be resolved against the root of the base the caller named. Cross-base containment is asserted end to end in [`src/main/files/cross-base.test.ts`](./src/main/files/cross-base.test.ts), with two bases sitting as siblings on disk so `../` arithmetic from one lands in the other.
- Every tool input goes through two checks before any FS access:
  1. **Lexical** — `resolveWithinRoot()` normalises separators, strips leading slashes, then asserts the resolved absolute path is strictly inside the root. Inputs that resolve outside via `..` or absolute-style paths are rejected with `Path escapes root: "<input>"`.
  2. **Physical** — `assertRealPathWithinRoot()` calls `fs.realpath` on both the root and the target (or its deepest existing ancestor for new-file writes) and verifies the realpath of the target lives inside the realpath of the root. This rejects symlink-based escapes that the lexical check cannot see.
- **Protected paths** are filtered out of list tools and rejected by read/write tools with `Path is protected: "<path>"`. Two rules:
  - any path segment beginning with `.` is protected at any depth (covers `.git`, `.obsidian`, `.env`, etc.);
  - root-level basenames `README`, `CLAUDE`, `LICENSE`, `CHANGELOG`, `CONTRIBUTING`, `SECURITY`, `CODE_OF_CONDUCT`, `AGENTS` (case-insensitive, with optional `.md`/`.txt`) are protected so the KB folder's own repo-meta isn't exposed. Nested files with the same names (e.g. `archive/README.md`) remain accessible.
- **Root-file exception** — `kb_read` is read-only and permits no discovery outside declared zones. After the normal lexical and physical root checks, it reads only an exact `root_file_allowlist` entry from `.ki.toml`; defaults are `README.md`, `AGENTS.md`, and `CLAUDE.md`. This narrowly permits repository context and named agent instructions without exposing other root files or dot-directories.
- **No paths on the wire** — `kb_config` reports aliases, zone names and staging names, never a filesystem path, so the caller's contract stays the alias and a base can be re-homed on disk without any caller changing.
- **Content discipline** — `kb_read` returns base64 for non-UTF-8 content and accepts Markdown `part` selection only for UTF-8 `.md` files. `kb_list` distinguishes files, folders, and Markdown notes while retaining the same zone and protected-path rules.
- The server has no network access and performs no authentication. Trust is delegated entirely to the local OS user running it.

## Directory Structure

```text
├── claude-config-sample.json   # Example Claude Desktop config
├── package.json
├── tsconfig.json               # Base TS config
├── tsconfig.build.json         # Build config (emits to dist/)
├── .env.example                # Env template (copy to .env.development or .env.local)
├── src/
│   ├── mcp-server/index.ts     # MCP server entry — loadConfig() + registers tools
│   ├── config/index.ts         # loadConfig(env?) → Config, selectKnowledgeBase (no singleton)
│   ├── tools/                  # MCP tool definitions (validate args, call main/, map to envelope)
│   │   ├── kb/index.ts         # registerKbTools(server, cfg)
│   │   └── shared.ts           # The required `kb` selector argument
│   ├── main/                   # Real implementation, usable outside the MCP server
│   │   ├── files/index.ts      # Generic content handlers (read/list/write/rename/delete)
│   │   └── notes/index.ts      # Internal Markdown and folder helpers
│   └── utils/                  # Cross-MCP helpers
│       ├── utils.ts            # Path safety + result helpers
│       ├── protected.ts        # Protected-path predicate
│       ├── access-level.ts     # Annotation-driven access-level gate
│       ├── annotations.ts      # Annotation presets (READ_ONLY/WRITE/…)
│       └── audit-log.ts        # JSONL audit log + rotation
└── dist/                       # Build output (gitignored, created by `bun run build`)
    └── mcp-server/index.js     # Compiled entry point used by Claude Desktop
```

## Troubleshooting

**`MCP_KI_KB_FS_KNOWLEDGE_BASES must be set to a JSON object …`**

The server aborts at startup if the declaration is missing or blank. Set it in the Claude Desktop config `env` block, or as a shell variable for `bun run ki:server:mcp:dev`.

**`MCP_KI_KB_FS_KNOWLEDGE_BASES is not valid JSON` / `must be a JSON object …`**

The value must parse as a JSON object of alias → path strings. In a client config file the whole object is itself a JSON string, so its inner quotes need escaping — see [`claude-config-sample.json`](./claude-config-sample.json).

**`MCP_KI_KB_FS_KNOWLEDGE_BASES alias "<alias>" points at a path that does not exist`**

Every declared path is checked at startup, not on first use. Verify the path, and check that `~` was expanded as you expected (the server expands a leading `~/` itself). A path that exists but is a file, or a path that is relative, is refused the same way.

**`MCP_KI_KB_FS_KNOWLEDGE_BASES declares alias "<alias>" more than once`**

JSON keeps only the last of two identical keys, so a repeated alias would silently pick a winner — possibly a different base than intended. Rename or remove one.

**Tool call rejected with `Invalid enum value` for `kb`**

The alias isn't declared, or was omitted. There is no default base by design: call `kb_config` with any declared alias to list the whole roster.

**Tool returns `Path escapes root`**

The requested path resolves outside the selected base's root, either lexically (`..`/absolute) or via a symlink whose target sits outside it. This applies even when the target is another declared base. Use KB-relative paths, name the base you mean in `kb`, and check any symlinks inside the KB.

**Tool returns `Path is protected`**

The path matches a protected pattern (a dotfile/dotdir at any depth, or a root-level repo-meta basename like `README.md`/`CLAUDE.md`). These paths are intentionally not exposed by the MCP. If you need a meta-named note, place it below the root (e.g. `archive/README.md`).

**`part` is rejected by `kb_read`**

`part: "frontmatter"` and `part: "body"` are available only for UTF-8 `.md` files. Use `part: "all"` for every other file type.

**Cannot find module after pulling changes**

```bash
bun install
```

## Extending the Server

Add a new tool by registering it in [`src/tools/kb/index.ts`](./src/tools/kb/index.ts) (or a new group under `src/tools/`) via `server.registerTool(...)`, and put the implementation in a matching `src/main/` module that takes a resolved `KnowledgeBase` as its first argument. Follow the existing pattern:

1. Validate inputs with a strict zod schema (`.strict()` to reject extras), including `kb: kbArg(cfg)` from [`src/tools/shared.ts`](./src/tools/shared.ts) — every tool requires the selector.
2. Set MCP annotations honestly (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) — the access-level gate derives the tool's tier from these.
3. Resolve the base once, in the handler, with `selectKnowledgeBase(cfg, kb)`, and pass only that base down. Then run any path inputs through `resolveWithinRoot(base.rootPath, ...)` (and `assertRealPathWithinRoot` for FS-touching tools) before touching the filesystem.
4. Declare an `outputSchema` using the same zod schema that types the `src/main/` function's return value, so the advertised schema and the emitted `structuredContent` cannot drift.
5. Keep registrations in ascending alphabetical order by tool name within the group file.
6. Let the `src/main/` function throw on failure, and catch it in the tool handler, returning `errorResult(...)` so the client sees `isError: true`. A throw that escapes the handler becomes a protocol error and bypasses the audit log.

The tool layer stays thin — validate args, resolve the `kb` alias, call a `src/main/` function with the resolved base, map the returned plain data to an MCP envelope with `jsonResult` / `errorResult` from [`src/utils/results.ts`](./src/utils/results.ts). The generic content logic lives in [`src/main/files/index.ts`](./src/main/files/index.ts), with Markdown-specific helpers retained in [`src/main/notes/index.ts`](./src/main/notes/index.ts).
