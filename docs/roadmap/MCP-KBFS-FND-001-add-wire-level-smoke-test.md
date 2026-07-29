---
id: MCP-KBFS-FND-001
title: Add wire-level smoke test
theme: foundation-tooling
horizon: soon
status: open
blocks: []
blocked-by: []
baseline-ref: null
---

## Context

Add `bun run ki:test:smoke` to boot the built server and verify that the wire-level tool surface matches in-process registration.

## Boundary

Use mcp-gmail’s `scripts/smoke.ts` and CI step as the reference implementation.
