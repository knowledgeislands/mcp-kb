import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { Config } from '../../config/index.js'
import { kbConfigResultSchema, readKbConfig } from '../../main/config/index.js'
import { READ_ONLY } from '../../utils/annotations.js'
import { errorResult, jsonResult } from '../../utils/results.js'

export const registerConfigTools = (server: McpServer, cfg: Config): void => {
  server.registerTool(
    'kb_config',
    {
      title: 'KB Config',
      description: `Return the Knowledge Islands configuration for this KB: resolved zone names,
staging area names, the root-file read allow-list, and the raw .ki-config.toml content.

Use this as an orientation step when working with an unfamiliar KB — it tells
you which top-level folders correspond to each canonical zone (Calendar, Pillars,
Resources, Streams, Admin) and which staging areas (+/ and -/) are configured.

The zone map is derived from .ki-config.toml at server startup; if the file is
absent, all zones use their canonical defaults.

Takes no parameters. Returns a JSON object with:
- zones: { Calendar, Pillars, Resources, Streams, Admin }
- staging: { inbound, outbound }
- rootFileAllowlist (exact paths available through kb_read)
- kiConfigPresent (boolean)
- kiConfigRaw (string — raw TOML or "(absent — all zones are defaults)")`,
      inputSchema: z.object({}).strict(),
      outputSchema: kbConfigResultSchema,
      annotations: READ_ONLY
    },
    () => {
      try {
        return jsonResult(readKbConfig(cfg))
      } catch (err) {
        return errorResult('reading KB config', err)
      }
    }
  )
}
