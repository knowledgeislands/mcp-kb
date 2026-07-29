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

The declaration is also the authorisation boundary for the install, not merely a convenience. The environment declares which paths this server may touch, each under a caller-facing alias; a base that is not declared is unreachable, and no argument can widen the set at call time. Callers name the alias rather than a path, so a repository can move on disk without changing anything a caller sends.

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

1. Add an alias-to-path declaration to `loadConfig`, replacing `MCP_KI_KB_FS_ROOT_PATH`. Each entry pairs a caller-facing alias with an absolute path after home expansion. Reject a malformed declaration, a duplicate alias, an alias that is not a safe identifier, and a path that is not an existing directory, at startup rather than on first use.
2. Replace `Config`'s flat `rootPath`, `zones`, `rootFileAllowlist`, and `kiConfigRaw` with a collection keyed by alias, resolving each declared base's `.ki-config.toml` once at startup through the existing `loadKiConfig`. Keep `accessLevel` and the audit-log fields server-wide.
3. Add a required `kb` argument to each of the seven tools, validated against the declared aliases so an unknown alias is refused by schema validation before any filesystem call. Resolve the alias to its base in the tool layer and pass that base's root and zones to `main/`.
4. Change the `main/` signatures to take one resolved base rather than the whole `Config`, leaving every `resolveWithinRoot`, `assertRealPathWithinRoot`, and `isInScope` call unchanged — they already take a root or zones per call.
5. Make `kb_config` report the declared aliases and each one's resolved zones, so a caller can discover what this install permits without reading the environment. Keep one audit log and record the serving alias on each event.
6. Update `scripts/smoke.ts` and the tool-registration assertions for the changed input schemas, and update `README.md` and `CLAUDE.md` to document the alias declaration as the install's authorisation boundary.
7. Add tests for alias resolution, a refused undeclared alias, a refused malformed or duplicate declaration, and cross-base containment — specifically that a relative path under one alias cannot resolve into another declared base.

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
5. A test proves a relative path under one alias cannot resolve into another declared base, and that an undeclared alias is refused rather than defaulted.
6. A test proves a malformed declaration, a duplicate alias, and a path that is not an existing directory each fail at startup rather than on first call.
7. `bun run ki:test:smoke` lists seven tools whose input schemas each require `kb`, confirming the wire surface carries the selector rather than only the in-process registration.

## Dependencies / blocks

Nothing blocks this item and it blocks nothing; both frontmatter arrays are empty and that reflects the code.

It overlaps [MCP-KBFS-TOOL-001](MCP-KBFS-TOOL-001-add-conditional-writes-via-etag.md) in one place worth noting. Both change declared result schemas, and `readFileResultSchema` is `.strict()`, so whichever lands second rebases the other's schema change. That is a merge-order consideration rather than a dependency: neither needs the other to exist.

## Delegation

This is one sequential unit and should not be fanned out. The steps form a dependency chain rather than independent work: the `Config` shape must settle before the tool layer can select an alias, and the `main/` signatures cannot change until the tool layer passes a resolved base. Two agents working the config and tool layers concurrently would contend on the same call path and on the same result schemas.

Delegate it as a single judgment task with the security invariants stated in the brief, because the risky part is wiring — passing the right base's root to the right base's path — rather than any individual change. The verification gate is the cross-base containment test plus the enforced 100% coverage; both must be in the brief, since a plausible refactor can satisfy the type checker while crossing a base boundary.

If any part is separable, it is step 6 — the smoke, README, and CLAUDE.md updates — which can follow once the surface settles.

## Discussion

### Why an alias argument, decided

Three shapes were considered and the required alias argument was chosen. It changes all seven input schemas, which is the largest mechanical cost of the three, but it is the only one that keeps selection explicit at the call site and validated before any filesystem work.

A base-qualified path grammar such as `kit-pkb:Pillars/note.md` would leave the schemas untouched, but it puts base selection inside path parsing — which is precisely where containment is enforced. A parsing mistake would become a containment mistake, so the cheaper option buys its saving in the riskiest place.

A default base with an optional override was rejected despite being the smallest diff. A default is ambient configuration by another name, and the injected-configuration rule exists to prevent exactly that. Concretely: a call that meant one base but omitted the argument would silently act on the default, and with `destructive` access that is a silent write to the wrong knowledge base.

Aliases rather than paths follow from the same decision. The alias is the stable contract; the path behind it is an install detail, so a repository can be moved or re-homed without changing any caller.

### The declaration is an authorisation boundary

The environment does not merely list convenient roots — it defines what this install is permitted to reach. That reframes several choices. The declaration must be validated at startup rather than lazily, because a malformed entry should fail the server rather than surface as a confusing per-call error. An undeclared alias must be refused outright rather than defaulted. And no call-time argument may introduce a path, only select among declared aliases, so the reachable set cannot be widened by a caller.

### Containment across bases is the new risk

Today a traversal bug can only escape one root. With several roots resolved in one process, the failure mode becomes escaping _into a sibling base_, which is a confidentiality boundary rather than a filesystem one — the declared bases span personal, legal, and client material. The primitives already take a root per call, so the risk is not in the helpers but in the wiring: passing the wrong base's root to the right base's path. That is why step 6 asks for a cross-base containment test specifically, rather than trusting the existing per-root tests to generalise.

### The two non-knowledge-base registrations

`mcp-ki-kb-fs` and `mcp-m365` are code repositories, yet both are registered as knowledge bases. If that is deliberate, the declaration grammar has to accommodate roots with no KB zone structure, and `loadKiConfig`'s fallback to default zones already does so. If it is accidental, they should be dropped rather than carried into the consolidated declaration. Worth confirming before the grammar is fixed.

### Access level is uniform today

All thirteen registrations run at `destructive`. Collapsing them means one access level governs every base at once, where today each registration could in principle differ. Whether per-base access levels are wanted is a real question, but it is not required to make one registration sufficient, so it is noted here rather than added to the steps.
