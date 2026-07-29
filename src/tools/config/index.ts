import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { type Config, selectKnowledgeBase } from '../../config/index.js'
import { kbConfigResultSchema, readKbConfig } from '../../main/config/index.js'
import { READ_ONLY } from '../../utils/annotations.js'
import { errorResult, jsonResult } from '../../utils/results.js'
import { kbArg } from '../shared.js'

export const registerConfigTools = (server: McpServer, cfg: Config): void => {
  server.registerTool(
    'kb_config',
    {
      title: 'KB Config',
      description: `Return the Knowledge Islands configuration for one declared knowledge base:
resolved zone names, staging area names, the root-file read allow-list, and the
raw .ki-config.toml content — plus the roster of every knowledge base this
server may reach.

Use this as an orientation step when working with an unfamiliar KB — it tells
you which top-level folders correspond to each canonical zone (Calendar, Pillars,
Resources, Streams, Admin) and which staging areas (+/ and -/) are configured.

The zone map is derived from .ki-config.toml at server startup; if the file is
absent, all zones use their canonical defaults.

Returns a JSON object with:
- kb (the alias whose detail follows)
- zones: { Calendar, Pillars, Resources, Streams, Admin }
- staging: { inbound, outbound }
- rootFileAllowlist (exact paths available through kb_read)
- kiConfigPresent (boolean)
- kiConfigRaw (string — raw TOML or "(absent — all zones are defaults)")
- knowledgeBases (every declared alias with its zone and staging names)

Knowledge bases are addressed by alias throughout; filesystem paths are never
returned.`,
      inputSchema: z.object({ kb: kbArg(cfg) }).strict(),
      outputSchema: kbConfigResultSchema,
      annotations: READ_ONLY
    },
    ({ kb }) => {
      try {
        return jsonResult(readKbConfig(selectKnowledgeBase(cfg, kb), [...cfg.knowledgeBases.values()]))
      } catch (err) {
        return errorResult('reading KB config', err)
      }
    }
  )
}
