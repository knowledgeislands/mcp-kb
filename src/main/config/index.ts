/**
 * KB config orientation handler — returns the resolved zone map and raw
 * `.ki.toml` content for the selected knowledge base, plus the roster of
 * every base this install declares, so an agent can discover what the server
 * may reach without being told the environment.
 *
 * Reads from values resolved at startup, never from the filesystem at tool-call
 * time, so it is not subject to zone-scoping or protected-path guards. Bases are
 * reported by alias only: filesystem paths are deliberately never returned, so
 * the caller's contract stays the alias and a base can be re-homed on disk
 * without anything the caller sends (or sees) changing.
 *
 * Layer boundary: returns plain data. The `src/tools/` layer wraps it in an MCP
 * envelope.
 */
import { z } from 'zod'
import type { KnowledgeBase } from '../../config/index.js'

// Factory functions rather than shared schema instances: a reused instance makes
// zod emit a `$ref`/`$defs` pair into the advertised JSON Schema, and the shape
// is small enough that inlining it twice is the clearer contract.
const zonesSchema = () =>
  z
    .object({
      Calendar: z.string(),
      Pillars: z.string(),
      Resources: z.string(),
      Streams: z.string(),
      Admin: z.string()
    })
    .strict()
    .describe('Top-level folder name resolved for each canonical KB zone.')

const stagingSchema = () =>
  z
    .object({ inbound: z.string(), outbound: z.string() })
    .strict()
    .describe('Folder names of the inbound (+) and outbound (-) staging areas.')

/**
 * Shape of the value `readKbConfig` returns, and — via the same schema — the
 * `outputSchema` declared by the `kb_config` tool, so the declared schema and
 * the emitted `structuredContent` cannot drift.
 */
export const kbConfigResultSchema = z
  .object({
    kb: z.string().describe('Alias of the knowledge base this zone map, allow-list and .ki.toml belong to.'),
    zones: zonesSchema(),
    staging: stagingSchema(),
    rootFileAllowlist: z
      .array(z.string())
      .describe('Exact root-relative paths readable through kb_read; never writable.'),
    kiConfigPresent: z.boolean().describe('True when a .ki.toml was found at this KB root on server startup.'),
    kiConfigRaw: z.string().describe('Raw .ki.toml text, or a placeholder when the file is absent.'),
    knowledgeBases: z
      .array(
        z
          .object({
            kb: z.string().describe('Alias to pass as the kb argument of any tool.'),
            zones: zonesSchema(),
            staging: stagingSchema()
          })
          .strict()
      )
      .describe(
        'Every knowledge base this server may reach, with its resolved zone names. No filesystem paths: bases are addressed by alias only.'
      )
  })
  .strict()

export type KbConfigResult = z.infer<typeof kbConfigResultSchema>

const zonesOf = (base: KnowledgeBase): KbConfigResult['zones'] => ({
  Calendar: base.zones.Calendar,
  Pillars: base.zones.Pillars,
  Resources: base.zones.Resources,
  Streams: base.zones.Streams,
  Admin: base.zones.Admin
})

const stagingOf = (base: KnowledgeBase): KbConfigResult['staging'] => ({
  inbound: base.zones.inbound,
  outbound: base.zones.outbound
})

/**
 * `base` is the already-selected base whose detail is returned; `declared` is
 * every declared base, for the roster. Both come from the tool layer — this
 * function never resolves an alias itself.
 */
export const readKbConfig = (base: KnowledgeBase, declared: readonly KnowledgeBase[]): KbConfigResult => {
  return {
    kb: base.alias,
    zones: zonesOf(base),
    staging: stagingOf(base),
    rootFileAllowlist: [...base.rootFileAllowlist],
    kiConfigPresent: base.kiConfigRaw !== null,
    kiConfigRaw: base.kiConfigRaw ?? '(absent — all zones are defaults)',
    knowledgeBases: declared.map((entry) => ({ kb: entry.alias, zones: zonesOf(entry), staging: stagingOf(entry) }))
  }
}
