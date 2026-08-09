---
id: MCP-KBFS-TOOL-001
area: TOOL
title: Add ETag writes
theme: tool-surface
horizon: next
status: draft
blocks: []
blocked-by: []
baseline-ref: null
---

## Goal

Achieve the stated outcome: Add conditional writes via etag for kb_write.

## Context

Redesign `kb_write` around optional optimistic locking: return an `etag` from `kb_read`, accept an `if_match` write argument, and refuse stale writes.

## Boundary

With `if_match`, expose a safe write surface; retain a clearly destructive force-overwrite operation without it.

## Current state

There is no concurrency control anywhere in the write path. `writeFile` in [src/main/files/index.ts](../../src/main/files/index.ts) writes a sibling temp file and `rename`s it over the destination, which makes each write atomic but always last-writer-wins: it never inspects the current contents or mtime of the target before replacing it.

The tool named in this item's title does not exist under that name. The surface is seven tools — `kb_config`, `kb_delete`, `kb_folder_create`, `kb_list`, `kb_read`, `kb_rename`, `kb_write` — and the note-specific helpers in [src/main/notes/index.ts](../../src/main/notes/index.ts) are a library-only module (only `createFolder` is reached from a tool). The work therefore lands on `kb_read` and `kb_write`, backed by `readFile` and `writeFile` in `main/files/`.

Since the layer refactor, `main/` returns plain data or throws, and [src/tools/kb/index.ts](../../src/tools/kb/index.ts) maps that to an envelope via `jsonResult` / `errorResult` from [src/utils/results.ts](../../src/utils/results.ts). Every tool declares an `outputSchema` taken from the same zod schema that types the `main/` return value, and those schemas are `.strict()`. Adding an `etag` to a read result is therefore a declared output-contract change to `readFileResultSchema`, not an additive field that clients can ignore; `if_match` is likewise a change to the `kb_write` `inputSchema`.

Two read-shape facts constrain the design. `kb_read` can return a slice (`part: 'all' | 'frontmatter' | 'body'`) and can return base64 for non-UTF-8 content, so an etag has to be defined over the whole file on disk rather than over the returned `content`. `readFile` already stats the file and reports `size`, so the metadata needed for a validator is in hand.

`kb_write` is annotated `DESTRUCTIVE` and defaults `dry_run: true`. A conditional write does not change either fact — `if_match` narrows when the overwrite is allowed, it does not make the tool non-destructive — so the annotation preset and access-level gating stay as they are.

## Steps

- [ ] Decide and document the etag derivation (content hash versus stat-based validator), and make it total over both UTF-8 and binary files and independent of the `part` slice returned.
- [ ] Add the `etag` field to `readFileResultSchema` with a describe string, and populate it in `readFile` from the bytes already read.
- [ ] Add an optional `if_match` argument to the `kb_write` `inputSchema` and to `writeFile`, re-reading the target inside the write path and refusing on mismatch with a distinguishable error; keep the no-`if_match` path as today's force overwrite.
- [ ] Define the `dry_run` semantics for a conditional write — a preview must report whether the precondition currently holds without mutating — and extend `writeFileResultSchema` if that needs a field.
- [ ] Extend the tool descriptions in `src/tools/kb/index.ts` and the README tool table and `kb_read` / `kb_write` sections so the optimistic-locking contract is discoverable.
- [ ] Add contract tests for match, mismatch, missing-target, binary, and slice-read cases, and confirm the smoke test still sees the unchanged seven-tool surface.

## Files touched

- [src/main/files/index.ts](../../src/main/files/index.ts) — `readFileResultSchema`, `readFile`, `writeFile`, and any new etag helper
- [src/main/files/index.test.ts](../../src/main/files/index.test.ts) and [src/main/files/repository-contract.test.ts](../../src/main/files/repository-contract.test.ts) — conditional-write and etag contracts
- [src/tools/kb/index.ts](../../src/tools/kb/index.ts) — `kb_read` / `kb_write` schemas and descriptions
- [src/tools/kb/index.test.ts](../../src/tools/kb/index.test.ts) — registration assertions covering the changed input and output schemas
- [README.md](../../README.md) — tool table and the `kb_read` / `kb_write` sections

## Verify

1. `bun run test`
2. `bun run test:coverage` — coverage thresholds are 100% on lines, functions, branches, and statements, so every new mismatch and error branch needs a test; `main/files/` is not on the coverage exclude list.
3. `bun run ki:test:smoke` — the tool surface must remain the same seven tools.
4. `ki repo audit --repo .`
5. A conditional write with a stale `if_match` fails without modifying the file on disk, and a read followed by a write with the returned `etag` succeeds.

## Dependencies / blocks

This item is neither blocked by nor blocking another work item; `blocks` and `blocked-by` are empty. Its real dependency is internal: the output-schema contract established by the layer refactor, which makes any new result field a deliberate change to a declared `outputSchema` rather than an additive one.

## Discussion

### Etag derivation

A content hash is honest but requires reading the whole file on every read — which `readFile` already does — while a stat-based validator (mtime plus size) is cheaper but can miss same-second, same-size edits on coarse filesystem timestamps. The choice is open, and it should be made explicitly rather than falling out of the implementation.

### Precondition and atomicity

The existing temp-file-plus-`rename` write is atomic in the sense that no reader sees a partial file, but a check-then-write against `if_match` is not atomic against a concurrent writer: another process can replace the target between the validation read and the `rename`. Whether that residual window is acceptable — this is a single-user local filesystem server — or whether it warrants a stronger mechanism is the main unresolved question.

### Scope of the etag

Only `kb_write` is in scope for `if_match`. Whether `kb_delete` and `kb_rename` should eventually accept the same precondition is worth noting but is deliberately not decided here.
