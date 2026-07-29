---
id: MCP-KBFS-TOOL-002
title: Serve multiple knowledge bases from one server
theme: tool-surface
horizon: blocking
status: open
blocks: []
blocked-by: []
baseline-ref: null
---

## Context

One server instance serves exactly one knowledge base, so every KB needs its own registration. `~/.mcporter/mcporter.json` currently declares thirteen `mcp-ki-kb-fs` servers that differ only in `MCP_KI_KB_FS_ROOT_PATH`, all at `destructive` access. Each registration publishes the same seven tools, so a client sees roughly ninety-one tool definitions where seven plus a knowledge-base selector would do.

The cost is borne on every request, not only at setup: each registration is a separate process and its tools occupy the client's tool list whether or not that base is in use. Reducing thirteen registrations to one is therefore a context and process saving rather than a configuration tidy-up, which is why this takes priority over the rest of the queue.

Make one server able to address several declared knowledge bases, so a single registration replaces the fleet.

## Boundary

This item delivers the server-side capability. Editing `~/.mcporter/mcporter.json` to collapse the registrations is a follow-on step, not part of this work.

Legacy single-root configuration is deliberately not retained. This server has one operator, so a clean cutover is preferable to carrying two configuration grammars; `MCP_KI_KB_FS_ROOT_PATH` may be replaced outright rather than deprecated.

This item does not add cross-base operations. Reading, writing, or moving content between two knowledge bases in one call is out of scope, and each call continues to act within exactly one base.

## Current state

`loadConfig` asserts a single `MCP_KI_KB_FS_ROOT_PATH` at [src/config/index.ts:214](../../src/config/index.ts), resolves it at line 216, and derives `zones`, `rootFileAllowlist`, and `kiConfigRaw` from that one root through `loadKiConfig`, which reads `<root>/.ki-config.toml`. The resulting `Config` carries `rootPath` and its zone data as flat fields, so the single-base assumption is expressed in the configuration type itself rather than spread through the implementation.

The containment primitives are already base-agnostic, which is what makes this tractable. `resolveWithinRoot(root, relativePath)` and `assertRealPathWithinRoot(root, absPath)` in [src/utils/utils.ts](../../src/utils/utils.ts) take the root as their first argument, and `isInScope(relPath, zones)` in [src/utils/zones.ts](../../src/utils/zones.ts) takes zones explicitly. No security helper reads a global root.

What does assume one base is the call path between them. Functions in `src/main/` take `(cfg: Config, args)` and read `cfg.rootPath` and `cfg.zones` directly — `readFile` at [src/main/files/index.ts](../../src/main/files/index.ts) is representative — and no tool input schema names a knowledge base, so there is currently no way for a caller to express which base it means.

Two of the thirteen registrations point at code repositories rather than knowledge bases: one at this repository and one at `mcp-m365`. Whether those are intentional needs confirming, since it changes whether the consolidation covers eleven bases or thirteen.

The layer boundary and result contracts were corrected recently and constrain how this lands. `src/main/` returns plain data or throws, `src/tools/` maps that to an envelope through `src/utils/results.ts`, and all seven tools declare an `outputSchema` derived from the same zod schema that types the `main/` return. `readFileResultSchema` is `.strict()`, so echoing the serving base in a result is a breaking output-contract change rather than an additive one.

## Steps

1. Settle how a call addresses a base, before any code changes. The candidates are a required argument on every tool, a base-qualified path grammar, or a default base with an optional override. The third reintroduces ambient selection, which the injected-configuration rule exists to prevent, so it needs an explicit justification if chosen.
2. Settle the declaration grammar for several bases — a delimited list of paths, or a name-to-path mapping. Prefer explicit declaration over discovery by scanning a parent directory, which would reintroduce ambient filesystem behaviour.
3. Replace the flat root fields in `Config` with a keyed collection of resolved bases, each carrying its own `rootPath`, `zones`, and `rootFileAllowlist`, and resolve every declared base's `.ki-config.toml` once at startup.
4. Thread the selected base through the tool layer so `main/` functions receive one base's root and zones rather than reading them from a flat `Config`, keeping the existing containment calls unchanged.
5. Decide what `kb_config` reports now that several bases exist, and whether the audit log stays one file recording which base served each call.
6. Extend the tests to cover base selection, an unknown base name, and containment across bases — specifically that a path in one base cannot escape into another.

## Files touched

- [src/config/index.ts](../../src/config/index.ts) and [src/config/index.test.ts](../../src/config/index.test.ts) — the declaration grammar and the keyed base collection
- [src/tools/kb/index.ts](../../src/tools/kb/index.ts) and [src/tools/kb/index.test.ts](../../src/tools/kb/index.test.ts) — base selection, input schemas, and any `outputSchema` change
- [src/tools/config/index.ts](../../src/tools/config/index.ts) — what `kb_config` reports across bases
- [src/main/files/index.ts](../../src/main/files/index.ts), [src/main/notes/index.ts](../../src/main/notes/index.ts), [src/main/config/index.ts](../../src/main/config/index.ts) and their tests — accepting one base's root and zones
- [scripts/smoke.ts](../../scripts/smoke.ts) — `EXPECTED_TOOLS` and the asserted tool count if the surface changes
- [README.md](../../README.md) and [CLAUDE.md](../../CLAUDE.md) — the environment grammar and the multi-base invariant

## Verify

1. `bun run test`
2. `bun run test:coverage` — the enforced 100% statements, branches, functions, and lines must still pass
3. `bun run ki:test:smoke` — boots the built server and matches the wire surface against in-process registration
4. `ki repo audit --repo .`
5. A test proves a relative path in one declared base cannot resolve into another declared base, and that an undeclared base name is refused rather than defaulted.

## Dependencies / blocks

Nothing blocks this item and it blocks nothing; both frontmatter arrays are empty and that reflects the code.

It overlaps [MCP-KBFS-TOOL-001](MCP-KBFS-TOOL-001-add-conditional-writes-via-etag.md) in one place worth noting. Both change declared result schemas, and `readFileResultSchema` is `.strict()`, so whichever lands second rebases the other's schema change. That is a merge-order consideration rather than a dependency: neither needs the other to exist.

## Discussion

### Why the addressing decision comes first

Each of the three candidate shapes has a different blast radius. A required argument changes all seven input schemas and every call site but is unambiguous. A base-qualified path grammar leaves the schemas alone but overloads path parsing, which is where containment is enforced — a poor place to add ambiguity. A default base with an optional override is the smallest diff and preserves single-base ergonomics, but a default is ambient configuration by another name, and the surrounding standard exists to keep configuration injected rather than ambient. Deciding this first prevents rework, because steps 3 and 4 differ materially by choice.

### Containment across bases is the new risk

Today a traversal bug can only escape one root. With several roots resolved in one process, the failure mode becomes escaping _into a sibling base_, which is a confidentiality boundary rather than a filesystem one — the declared bases span personal, legal, and client material. The primitives already take a root per call, so the risk is not in the helpers but in the wiring: passing the wrong base's root to the right base's path. That is why step 6 asks for a cross-base containment test specifically, rather than trusting the existing per-root tests to generalise.

### The two non-knowledge-base registrations

`mcp-ki-kb-fs` and `mcp-m365` are code repositories, yet both are registered as knowledge bases. If that is deliberate, the declaration grammar has to accommodate roots with no KB zone structure, and `loadKiConfig`'s fallback to default zones already does so. If it is accidental, they should be dropped rather than carried into the consolidated declaration. Worth confirming before the grammar is fixed.

### Access level is uniform today

All thirteen registrations run at `destructive`. Collapsing them means one access level governs every base at once, where today each registration could in principle differ. Whether per-base access levels are wanted is a real question, but it is not required to make one registration sufficient, so it is noted here rather than added to the steps.
