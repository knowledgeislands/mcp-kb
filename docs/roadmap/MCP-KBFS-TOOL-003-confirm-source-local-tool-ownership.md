---
id: MCP-KBFS-TOOL-003
area: TOOL
title: Confirm tool ownership
theme: tool-surface
horizon: now
status: draft
blocks: []
blocked_by: []
baseline_ref: null
---

## Goal

Make every KB filesystem MCP tool visibly owned by its source module.

## Context

The estate audit reports `TOOL-1` because runtime-wide registration obscures source-local ownership.

## Boundary

Do not change a tool's public behaviour or add duplicate registrations.

## Current state

The registered tools work, but their source ownership cannot be proved mechanically.

## Steps

- [ ] Inventory each reported source-local tool and its registration.
- [ ] Choose one explicit local ownership declaration per tool.
- [ ] Re-run the focused audit.

## Files touched

- MCP tool source and registration modules.
- This roadmap record.

## Verify

- `ki repo audit --repo .` clears the reported `TOOL-1` warning.

## Dependencies / blocks

None.

## Documentation impact

### Decision Records

No decision record is expected unless ownership changes a public boundary.

### Specifications

Update tool specifications if ownership changes public registration.

### Guides

Update contributor guidance if the ownership convention changes.

### Roadmap

No follow-on work is known.

## Discussion

The repair should prove existing ownership rather than merely suppressing the audit signal.
