---
id: GDR-MCP-KBFS-001
title: 'Adopting Decision Records'
date: 2026-09-07
status: current
decision_type: governance
decision_type_url: https://knowledgeislands.info/specifications/decision-records/gdr
---

# GDR-MCP-KBFS-001: Adopting Decision Records

## Context

This repository makes durable governance, architecture, security, and operational choices that benefit from a concise record separate from implementation details and delivery plans. Those choices need a consistent format, stable identifiers, and a discoverable reading order.

## Decision

This repository adopts the Knowledge Islands Decision Records standard. Significant standalone decisions are recorded under `docs/decisions/`, use the appropriate typed prefix, appear in the collection index, and remain current through in-place revision.

## Consequences

Important decisions have one durable, reviewable home and can be cited by stable identifier. Authors incur a small maintenance cost and must distinguish a lasting decision from explanatory documentation or roadmap work.
