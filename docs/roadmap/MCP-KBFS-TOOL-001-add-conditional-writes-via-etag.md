---
id: MCP-KBFS-TOOL-001
title: Add conditional writes via etag for kb_note_write
theme: tool-surface
horizon: next
status: open
blocks: []
blocked-by: []
baseline-ref: null
---

## Context

Redesign `kb_note_write` around optional optimistic locking: return an `etag` from `kb_note_read`, accept an `if_match` write argument, and refuse stale writes.

## Boundary

With `if_match`, expose a safe write surface; retain a clearly destructive force-overwrite operation without it.
