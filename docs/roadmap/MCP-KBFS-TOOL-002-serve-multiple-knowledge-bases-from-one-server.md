---
id: MCP-KBFS-TOOL-002
area: TOOL
title: Serve multiple knowledge bases
theme: tool-surface
horizon: now
status: awaiting-review
blocks: []
blocked_by: []
baseline_ref: 61b1aba5d288ccc908962c1a8cf7ff4fa37235f3
---

## Goal

Achieve the stated outcome: Serve multiple knowledge bases from one server.

## Context

One server instance serves exactly one knowledge base, so every KB needs its own registration. `.chezmoidata/mcp-servers.yaml` declares eleven `mcp-ki-kb-fs` entries that differ only in `MCP_KI_KB_FS_ROOT_PATH`, all at `destructive` access, and each is rendered into both `claude-desktop` and `mcporter`. They are the majority of the server entries in that file, so this one server dominates the declared MCP estate.

Each registration publishes the same seven tools, so an affected client sees around seventy-seven tool definitions where seven plus a knowledge-base selector would do. The cost is borne on every request, not only at setup: each registration is a separate process and its tools occupy the client's tool list whether or not that base is in use. Reducing eleven registrations to one is therefore a context and process saving rather than a configuration tidy-up, which is why this takes priority over the rest of the queue.

Make one server able to address several declared knowledge bases, so a single registration replaces the fleet.

The declaration is also the authorisation boundary for the install, not merely a convenience. The environment declares which paths this server may touch, each under a caller-facing alias; a base that is not declared is unreachable, and no argument can widen the set at call time. Callers name the alias rather than a path, so a repository can move on disk without changing anything a caller sends.

## Boundary

This item delivers the server-side capability and proves it by collapsing the live registrations. The canonical, renderer-neutral source is `.chezmoidata/mcp-servers.yaml` in the dotfiles repository, rendered per client through the `mcp-servers-json` template; the change is made there and applied with chezmoi rather than edited in any client's generated file.

The consolidated declaration covers the eleven declared knowledge bases.

Legacy single-root configuration is deliberately not retained. This server has one operator, so a clean cutover is preferable to carrying two configuration grammars; `MCP_KI_KB_FS_ROOT_PATH` may be replaced outright rather than deprecated.

This item does not add cross-base operations. Reading, writing, or moving content between two knowledge bases in one call is out of scope, and each call continues to act within exactly one base.

## Current state

`loadConfig` asserts a single `MCP_KI_KB_FS_ROOT_PATH` at [src/config/index.ts:214](../../src/config/index.ts), resolves it at line 216, and derives `zones`, `rootFileAllowlist`, and `kiConfigRaw` from that one root through `loadKiConfig`, which reads `<root>/.ki-config.toml`. The resulting `Config` carries `rootPath` and its zone data as flat fields, so the single-base assumption is expressed in the configuration type itself rather than spread through the implementation.

The containment primitives are already base-agnostic, which is what makes this tractable. `resolveWithinRoot(root, relativePath)` and `assertRealPathWithinRoot(root, absPath)` in [src/utils/utils.ts](../../src/utils/utils.ts) take the root as their first argument, and `isInScope(relPath, zones)` in [src/utils/zones.ts](../../src/utils/zones.ts) takes zones explicitly. No security helper reads a global root.

What does assume one base is the call path between them. Functions in `src/main/` take `(cfg: Config, args)` and read `cfg.rootPath` and `cfg.zones` directly — `readFile` at [src/main/files/index.ts](../../src/main/files/index.ts) is representative — and no tool input schema names a knowledge base, so there is currently no way for a caller to express which base it means.

Two further registrations previously pointed at code repositories rather than knowledge bases — this repository and `mcp-m365` — and were removed from the declaration in dotfiles commit `591d4ce` before this item became ready. Every remaining declared root is a knowledge base, so the alias declaration need not accommodate roots without KB zone structure.

The layer boundary and result contracts were corrected recently and constrain how this lands. `src/main/` returns plain data or throws, `src/tools/` maps that to an envelope through `src/utils/results.ts`, and all seven tools declare an `outputSchema` derived from the same zod schema that types the `main/` return. `readFileResultSchema` is `.strict()`, so echoing the serving base in a result is a breaking output-contract change rather than an additive one.

## Steps

- [x] Add an alias-to-path declaration to `loadConfig`, replacing `MCP_KI_KB_FS_ROOT_PATH`. Each entry pairs a caller-facing alias with an absolute path after home expansion. Reject a malformed declaration, a duplicate alias, an alias that is not a safe identifier, and a path that is not an existing directory, at startup rather than on first use.
- [x] Replace `Config`'s flat `rootPath`, `zones`, `rootFileAllowlist`, and `kiConfigRaw` with a collection keyed by alias, resolving each declared base's `.ki-config.toml` once at startup through the existing `loadKiConfig`. Keep `accessLevel` and the audit-log fields server-wide.
- [x] Add a required `kb` argument to each of the seven tools, validated against the declared aliases so an unknown alias is refused by schema validation before any filesystem call. Resolve the alias to its base in the tool layer and pass that base's root and zones to `main/`.
- [x] Change the `main/` signatures to take one resolved base rather than the whole `Config`, leaving every `resolveWithinRoot`, `assertRealPathWithinRoot`, and `isInScope` call unchanged — they already take a root or zones per call.
- [x] Make `kb_config` report the declared aliases and each one's resolved zones, so a caller can discover what this install permits without reading the environment. Keep one audit log and record the serving alias on each event.
- [x] Update `scripts/smoke.ts` and the tool-registration assertions for the changed input schemas, and update `README.md` and `CLAUDE.md` to document the alias declaration as the install's authorisation boundary.
- [x] Add tests for alias resolution, a refused undeclared alias, a refused malformed or duplicate declaration, and cross-base containment — specifically that a relative path under one alias cannot resolve into another declared base.
- [x] Replace the eleven `mcp-ki-kb-fs` entries in `.chezmoidata/mcp-servers.yaml` with one declaring the eleven knowledge-base aliases, keeping its `clients` set as `[claude-desktop, mcporter]`, then apply with chezmoi and confirm the rendered configuration for both clients holds a single entry that serves each alias.

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

## Review

### Delivered

All eight steps. One server now serves every declared knowledge base, selected by a caller-facing alias, and the eleven per-base registrations are collapsed into one.

`MCP_KI_KB_FS_KNOWLEDGE_BASES` carries a JSON alias-to-path object and replaces `MCP_KI_KB_FS_ROOT_PATH` with no fallback, as the Boundary required. Each of the seven tools takes a required `kb` argument validated as a zod enum over the declared aliases, so an undeclared alias fails argument validation before any handler runs.

Deliberately excluded, per the Boundary: cross-base operations in a single call, per-base access levels, and any legacy single-root compatibility path.

### Summary of changes

`Config` gained `knowledgeBases: ReadonlyMap<string, KnowledgeBase>` in place of the flat `rootPath`, `zones`, `rootFileAllowlist`, and `kiConfigRaw`. A `Map` rather than an object, so no alias can collide with an inherited `Object.prototype` key. `accessLevel` and the audit-log fields stay server-wide.

`src/main/` entry points take `base: KnowledgeBase` rather than `Config`. Every `resolveWithinRoot`, `assertRealPathWithinRoot`, and `isInScope` call site is otherwise unchanged, which was the point: the containment primitives already took a root or zones per call, so the change is in the wiring above them.

A new `src/tools/shared.ts` holds the `kb` argument definition once, and each handler resolves the alias through `selectKnowledgeBase` before calling `main/`. `kb_config` reports the selected base plus the declared roster, and returns no filesystem paths.

Startup validation rejects a blank or invalid declaration, a non-object, a non-string value, a duplicate alias, an alias failing `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`, an empty declaration, an empty path, a relative path, a non-existent path, and a non-directory path.

In the dotfiles repository, `.chezmoidata/mcp-servers.yaml` now declares one `kit-mcp-ki-kb-fs` entry with all eleven aliases, rendering to six mcporter servers where there were sixteen.

### Verification

Every gate was run and its output inspected rather than taken from the implementing agent's report.

1. `bunx tsc --noEmit` — clean.
2. `bun run test` — 289 passed across 12 files.
3. `bun run test:coverage` — 100% statements (687/687), branches (440/440), functions (79/79), lines (630/630), against the enforced 100% threshold.
4. `bun run ki:test:smoke` — boots two temporary bases and reports seven tools, all schemas present, each requiring `kb` constrained to the declared aliases, so the selector is proven on the wire rather than only in process.
5. `ki repo audit --repo .` — `FAIL=0 WARN=0`.
6. Cross-base containment, `src/main/files/cross-base.test.ts` — two sibling bases under one parent so `..` arithmetic lands in the neighbour; six traversal shapes refused across read, list, write, delete, rename, and folder creation; the sibling's bytes asserted unchanged after every write and delete attempt; symlink escapes refused for both a file and a directory; and the same content proven reachable through its own alias, so the refusals are about the boundary rather than a missing fixture.
7. Declaration validation — undeclared alias, malformed JSON, duplicate alias, and non-directory path each covered in `src/config/index.test.ts`.
8. Live check against real bases — one server resolved `kit-pkb`, `hnr-shared`, and `kit-legal` to their own roots and listed each one's `Pillars` zone; an undeclared alias was refused.

Baseline `61b1aba5d288ccc908962c1a8cf7ff4fa37235f3`. Resulting commits `f37d11e`, `558ecae`, merged as `d1af69e`. Dotfiles commit `7736223`, on top of `591d4ce` which removed the two code-repository registrations.

### Outstanding concerns

Claude Desktop retains thirteen stale `mcp-ki-kb-fs` entries and cannot be corrected from the declaration. Its config is produced by `modify_private_claude_desktop_config.json.tmpl`, whose `mergeMcpServers` is `{ ...existing, ...desired }` and documents that undeclared server records remain untouched. Source removals therefore never propagate, `chezmoi diff` reports clean, and each stale entry sets only the removed `MCP_KI_KB_FS_ROOT_PATH` so it will fail to start. The owner accepted this and took it on directly; it is outside this item's boundary.

Three additive deviations from the plan, all narrowing rather than widening behaviour: relative root paths are rejected, because a relative root resolves against the host's launch directory and would make the authorisation boundary depend on ambient state; `kb_config` returns the roster alongside the selected base, since the plan's reporting requirement had to coexist with `kb` being required on all seven tools; and `src/tools/shared.ts` is a non-`index.ts` file under `src/tools/`, so it is coverage-included and is fully covered.

### Post-change review

The delivery remains within the approved multi-base boundary. The observed Claude Desktop stale-entry limitation is retained as an explicit owner-accepted concern rather than being treated as a silent cleanup or a new server behaviour.

### Mini recap

The plan's judgement that this was smaller than it looked held up: the containment helpers were already root-parameterised, so the work was config shape and threading rather than a security rewrite. The decision to make `kb` required rather than defaulted is what made the result verifiable — a default base would have left a silent-wrong-base failure mode that no test could reasonably assert against.

Proposed learning route, not applied: the additive-merge property of the Claude Desktop config transform means removing any server from the canonical declaration is silently ineffective for that client. That is a durable fact about the dotfiles repository rather than about this server, so it belongs to a dotfiles work item if the owner wants it fixed generally.

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

### Access level stays per registration, by construction

All eleven entries run at `destructive`, so collapsing them changes nothing in practice. More importantly, a per-base access level is not merely unimplemented — it is incoherent within one server, because the access level selects the tool surface rather than filtering calls.

`makeAccessGatedRegister` wraps `server.registerTool` and returns before registering any tool whose derived level exceeds `config.accessLevel` ([src/utils/access-level.ts](../../src/utils/access-level.ts)). A gated tool is therefore never registered and never appears on the wire. One server publishes exactly one surface, decided at boot, so `kb_write` cannot exist for one alias and be absent for another.

Differing levels are expressed the way they already are: a second registration of the same server at the other level, declaring only the bases that should be reachable at it. That remains possible and needs nothing from this item. It also means the alias declaration and the access level compose — the declaration bounds _which_ bases a registration may reach, and the level bounds _what_ it may do to them.
