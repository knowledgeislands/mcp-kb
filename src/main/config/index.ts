/**
 * KB config orientation handler — returns the resolved zone map and raw
 * `.ki-config.toml` content for an agent bootstrapping against this KB.
 *
 * Reads from `Config` (loaded at startup), never from the filesystem at
 * tool-call time, so it is not subject to zone-scoping or protected-path guards.
 *
 * Layer boundary: returns plain data. The `src/tools/` layer wraps it in an MCP
 * envelope.
 */
import { z } from 'zod'
import type { Config } from '../../config/index.js'

/**
 * Shape of the value `readKbConfig` returns, and — via the same schema — the
 * `outputSchema` declared by the `kb_config` tool, so the declared schema and
 * the emitted `structuredContent` cannot drift.
 */
export const kbConfigResultSchema = z
  .object({
    zones: z
      .object({
        Calendar: z.string(),
        Pillars: z.string(),
        Resources: z.string(),
        Streams: z.string(),
        Admin: z.string()
      })
      .strict()
      .describe('Top-level folder name resolved for each canonical KB zone.'),
    staging: z
      .object({ inbound: z.string(), outbound: z.string() })
      .strict()
      .describe('Folder names of the inbound (+) and outbound (-) staging areas.'),
    rootFileAllowlist: z.array(z.string()).describe('Exact root-relative paths readable through kb_read; never writable.'),
    kiConfigPresent: z.boolean().describe('True when a .ki-config.toml was found at KB root on server startup.'),
    kiConfigRaw: z.string().describe('Raw .ki-config.toml text, or a placeholder when the file is absent.')
  })
  .strict()

export type KbConfigResult = z.infer<typeof kbConfigResultSchema>

export const readKbConfig = (cfg: Config): KbConfigResult => {
  return {
    zones: {
      Calendar: cfg.zones.Calendar,
      Pillars: cfg.zones.Pillars,
      Resources: cfg.zones.Resources,
      Streams: cfg.zones.Streams,
      Admin: cfg.zones.Admin
    },
    staging: {
      inbound: cfg.zones.inbound,
      outbound: cfg.zones.outbound
    },
    rootFileAllowlist: [...cfg.rootFileAllowlist],
    kiConfigPresent: cfg.kiConfigRaw !== null,
    kiConfigRaw: cfg.kiConfigRaw ?? '(absent — all zones are defaults)'
  }
}
