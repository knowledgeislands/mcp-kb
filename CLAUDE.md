# CLAUDE.md

Guidance for Claude Code when working in this repo. The user-facing tool surface, install/config, and Claude Desktop setup live in [README.md](./README.md); this file covers what Claude needs that isn't in README and isn't derivable from one grep.

## Bun vs Node

This project uses Bun (≥ 1.3) for install and dev scripts, but the compiled `dist/` runs under Node (≥ 22) — that's what Claude Desktop launches.

- `bun run test` (NOT `bun test` — the latter invokes Bun's own runner instead of vitest).
- Bun auto-loads `.env.${NODE_ENV}` from the CWD; Node needs the explicit `process.loadEnvFile()` call inside `loadConfig()` in [src/config/index.ts](./src/config/index.ts). The try/catch swallows the `TypeError` Bun raises (no `process.loadEnvFile`), so the same code works under both.
- `NODE_ENV` is set to `development` only by `ki:server:mcp:dev` and `ki:server:mcp:inspect`. Claude Desktop doesn't set it, so `.env.*` is ignored in production — `MCP_KI_KB_FS_KNOWLEDGE_BASES` must come from the Claude Desktop config `env` block.

Run `bun run` with no args for the full script list.

This server targets MCP spec revision **2025-11-25**.

## Architecture Invariants

### Project layout & config injection (the workspace MCP shape)

This is the canonical layout we roll out across the MCPs:

- **[src/config/index.ts](./src/config/index.ts)** — `loadConfig(env?) → Config`. Reads env (optionally hydrated from `.env.${NODE_ENV}`) into a plain `Config` value. **There is no module-level config singleton — nothing reads env at import time.** `Config` carries `knowledgeBases` (the declared alias → `KnowledgeBase` map), `accessLevel`, and the four audit-log fields. It also exports `selectKnowledgeBase(cfg, alias)` and `knowledgeBaseAliases(cfg)` — see [Multiple knowledge bases](#multiple-knowledge-bases).
- **[src/mcp-server/index.ts](./src/mcp-server/index.ts)** — the stdio MCP wrapper. Calls `loadConfig()` once, builds the `AuditConfig` slice, and threads the `Config` into tool registration. Excluded from coverage.
- **[src/tools/](./src/tools/)** — MCP tool definitions only. Thin: validate args (zod), resolve the `kb` alias, call a `main/` function with the resolved base, map result/throw to an MCP envelope. `registerKbTools(server, cfg)`, `registerConfigTools(server, cfg)`. The group `index.ts` files are excluded from coverage; [src/tools/shared.ts](./src/tools/shared.ts) (the shared `kb` argument) is not.
- **[src/main/](./src/main/)** — the real implementation, usable outside the MCP server (e.g. from a script). Grouped by concern, mirroring the tool groups: `main/files/index.ts` (read/list/write/rename/delete — what the `kb_*` tools call), `main/notes/index.ts` (the Markdown-specific variants plus `createFolder`), `main/config/index.ts` (`readKbConfig`). Every `main` entry point takes one resolved `KnowledgeBase` as its **first argument** — `readNote(base, { path })`, `writeNote(base, args)` — never the whole `Config`. No hidden state, and no ability to reach a base the caller didn't name.
- **[src/utils/](./src/utils/)** — cross-MCP reusable helpers; keep in sync with sibling repos. These take the **specific config primitive** they need (e.g. `resolveWithinRoot(rootPath, …)`, `withAuditLog(auditConfig, …)`, `makeAccessGatedRegister(server, accessLevel, audit)`), not the whole `Config`, so they stay MCP-agnostic. `isProtectedPath(relPath)` ([src/utils/protected.ts](./src/utils/protected.ts)) is a pure relpath guard with no config dependency.

To use the code from a script: `const cfg = loadConfig(); const base = selectKnowledgeBase(cfg, 'kit-pkb'); await writeNote(base, { path: 'Pillars/note.md', content, create_dirs: true, dry_run: false })`.

### Multiple knowledge bases

One server serves every base declared in `MCP_KI_KB_FS_KNOWLEDGE_BASES` — a JSON object mapping caller-facing alias to that base's absolute (or `~/…`) path. README's [Environment Variables](./README.md#environment-variables) documents the grammar and every startup rejection; what matters when changing code:

- **The declaration is the authorisation boundary, validated at startup.** `loadConfig()` resolves each entry into a `KnowledgeBase` (`alias`, `rootPath`, `zones`, `rootFileAllowlist`, `kiConfigRaw`) and throws unless the alias is a safe identifier and the path is an existing directory. Nothing is resolved lazily, and there is **no `MCP_KI_KB_FS_ROOT_PATH` fallback** — do not add one.
- **`kb` is required on all seven tools.** It is declared once, as `kbArg(cfg)` in [src/tools/shared.ts](./src/tools/shared.ts), as a zod enum over the declared aliases — so an undeclared alias fails argument validation before a handler runs, and the wire schema advertises the roster. Never give it a default, and never accept a bare `z.string()`: a base-qualified path grammar or an optional override would both put base selection somewhere a mistake becomes a containment mistake.
- **Base resolution is single-sourced.** `selectKnowledgeBase(cfg, alias)` in [src/config/index.ts](./src/config/index.ts) is the only place an alias becomes a root. Every handler is `async ({ kb, ...args }) => … main(selectKnowledgeBase(cfg, kb), args)`; `grep -n 'selectKnowledgeBase' src/tools` should show exactly one call per tool and nothing outside `src/tools/`. Because `main/` takes `KnowledgeBase` and `Config` no longer has `rootPath`/`zones`, passing the wrong thing is a type error rather than a silent cross-base read.
- **Access level stays server-wide.** `makeAccessGatedRegister` returns before registering a gated tool, so one server publishes exactly one surface, decided at boot. Per-base access levels are not merely unimplemented, they are incoherent here — don't attempt them. Declaration bounds _which_ bases the install may reach; `MCP_KI_KB_FS_ACCESS_LEVEL` bounds _what_ may be done in them.
- **A base is a closed bundle.** Root, zone map and allow-list travel together on one object, so there is no way to pair one base's root with another's zone configuration. Keep it that way — don't thread `rootPath` and `zones` separately through new code.

### Naming convention

Tool names follow `<app>_<resource>_<action>` (snake_case) with `<app>` = `kb`. Plural resource for collection ops, singular for single-item ops (`kb_notes_list`, `kb_folders_list`, `kb_note_read`, `kb_note_write`).

### Access-level gate — driven by annotations, not names

[src/utils/access-level.ts](./src/utils/access-level.ts) `makeAccessGatedRegister(server, accessLevel, audit)` decides at startup whether to register each tool, based on `config.annotations`:

- `readOnlyHint: true` → `read`
- `destructiveHint: true` → `destructive`
- explicit `readOnlyHint: false` AND `destructiveHint: false` → `write` (non-destructive mutation)
- anything else (unannotated / partially annotated) → `destructive` (fail-safe)

A tool registers when its derived level is at or below `cfg.accessLevel` (from `MCP_KI_KB_FS_ACCESS_LEVEL`, default: `read`). Levels nest: `read` registers only readers; `write` adds non-destructive mutations (rename, mkdir); `destructive` adds the rest (overwrite, delete). New tools MUST set `annotations` to one of the presets in [src/utils/annotations.ts](./src/utils/annotations.ts): `READ_ONLY`, `WRITE`/`WRITE_IDEMPOTENT` (write tier — non-idempotent vs. retry-safe), or `DESTRUCTIVE`. Do not bypass the proxy.

## Security Requirements

This server reads and writes files anywhere under any declared knowledge-base root. New tools and changes to existing tools MUST preserve every invariant below.

1. **Two-layer path containment, every call site.** Before any `fs.*` call, run user input through **both** `resolveWithinRoot()` (lexical guard — rejects `..`, absolute-style inputs, Windows separators) AND `assertRealPathWithinRoot()` (realpath guard — rejects symlink escapes). For new-file writes the realpath guard checks the deepest existing ancestor. Both live in [src/utils/utils.ts](./src/utils/utils.ts).
2. **Protected paths are non-negotiable.** Every read/write/list handler calls `isProtectedPath()` ([src/utils/protected.ts](./src/utils/protected.ts)). Dotfiles/dotdirs at any depth and root-level repo-meta names (README, CLAUDE, LICENSE, CHANGELOG, CONTRIBUTING, SECURITY, CODE_OF_CONDUCT, AGENTS — with optional `.md`/`.txt`) must remain unreachable. New FS-touching tools must call this filter.
3. **File-type discipline.** Note tools only accept `.md` paths and reject directories. New tools that walk the tree must filter by intended type, not return arbitrary files.
4. **Destructive tools require `dry_run` default `true`.** `kb_note_write` defaults to a `[dry_run] would create/overwrite (N bytes)` preview; only mutates when `dry_run: false` is explicit. New `DESTRUCTIVE`-annotated tools must follow this.
5. **Zod schemas are `.strict()`.** Already true everywhere; new schemas must continue this.
6. **No shell-string interpolation.** This server doesn't shell out today. If a future tool needs to, use `execFile` with an argv array.
7. **Error messages must not leak the absolute root.** Surface what the caller asked for via `path.relative(base.rootPath, ...)`. The same rule applies to results: `kb_config` reports aliases and zone names, never paths.
8. **Cross-base containment is the new failure mode.** With one root, a traversal bug escaped into unaddressable territory; with several roots in one process it can land _inside a sibling declared base_ — a confidentiality boundary, since declared bases span personal, legal and client material. `resolveWithinRoot`, `assertRealPathWithinRoot` and `isInScope` already take the root/zones per call, so the risk is never in the helpers: it is in the wiring, passing one base's root with another base's path. Any change to that wiring must keep [src/main/files/cross-base.test.ts](./src/main/files/cross-base.test.ts) passing — it declares two bases as siblings on disk and asserts no input shape, including symlinks, crosses from one into the other.

Traversal- and symlink-rejection tests live in [src/main/notes/index.test.ts](./src/main/notes/index.test.ts); their cross-base equivalents in [src/main/files/cross-base.test.ts](./src/main/files/cross-base.test.ts).

## Tool registration call sites

Tools are registered in [src/tools/config/index.ts](./src/tools/config/index.ts) (`kb_config`) and [src/tools/kb/index.ts](./src/tools/kb/index.ts) (the other six). To survey the surface, `grep "registerTool" src/tools/*/index.ts`. README's [Available Tools](./README.md#available-tools) tabulates them with purposes.

Within each group file, `server.registerTool(...)` calls are kept in ascending alphabetical order by tool name — the `ki-mcp` TOOL-1 check enforces it.

## Result envelopes and `outputSchema`

The layer boundary is strict: `src/main/` returns **plain data** and signals failure by **throwing**. Only `src/tools/` knows the MCP wire format, via `jsonResult` / `errorResult` in [src/utils/results.ts](./src/utils/results.ts). Every tool handler must wrap its `main/` call in try/catch and return `errorResult(<action>, err)` — never let a throw escape, since a thrown error becomes a protocol error and bypasses the audit-log wrapper.

The `kb_config` result carries the selected base's detail plus a `knowledgeBases` roster of every declared alias with its zone names — so a client can discover the install's reach in one read-only call, without any path being disclosed.

Each tool declares an `outputSchema`, and it is the **same zod schema** that types the `main/` function's return value via `z.infer`. The schemas live next to their implementation — `readFileResultSchema`, `listContentResultSchema`, `writeFileResultSchema`, `renameFileResultSchema`, `deleteFileResultSchema` in [src/main/files/index.ts](./src/main/files/index.ts), `createFolderResultSchema` in [src/main/notes/index.ts](./src/main/notes/index.ts), `kbConfigResultSchema` in [src/main/config/index.ts](./src/main/config/index.ts). One source means the advertised JSON Schema and the emitted `structuredContent` cannot drift. A new tool must add a schema the same way, not hand-write a second shape.
