#!/usr/bin/env node

/**
 * mcp-ki-kb-fs
 *
 * Local stdio MCP server providing zone-scoped read/write access to one or more
 * Knowledge Islands knowledge bases on the local filesystem. Each call names the
 * base it acts in by alias; every path is then constrained to that base's
 * declared KI zones (Calendar, Pillars, Resources, Streams, Admin) and staging
 * areas (+ inbound, - outbound), as resolved from its .ki-config.toml at startup.
 *
 * Configuration (environment variables):
 *   MCP_KI_KB_FS_KNOWLEDGE_BASES   JSON object of alias → knowledge-base path.
 *                                  This declaration is the authorisation
 *                                  boundary: an alias that is not declared here
 *                                  is unreachable, and it is validated in full
 *                                  by loadConfig() before the server connects.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { KNOWLEDGE_BASES_ENV_VAR, loadConfig } from '../config/index.js'
import { registerConfigTools, registerKbTools } from '../tools/index.js'
import { makeAccessGatedRegister } from '../utils/access-level.js'

const config = loadConfig()

console.error('mcp-ki-kb-fs starting...')
console.error(`  MCP_KI_KB_FS_ACCESS_LEVEL=${config.accessLevel}`)
console.error(
  `  MCP_KI_KB_FS_AUDIT_LOG=${config.auditLogMode}${config.auditLogMode === 'off' ? '' : ` (path: ${config.auditLogPath})`}`
)
console.error(`  ${KNOWLEDGE_BASES_ENV_VAR} — ${config.knowledgeBases.size} knowledge base(s):`)
for (const base of config.knowledgeBases.values()) {
  console.error(`    ${base.alias} → ${base.rootPath} (zones: ${Object.values(base.zones).join(', ')})`)
}

const server = new McpServer({
  name: 'mcp-ki-kb-fs',
  version: '0.9.0'
})

// Monkey-patch registerTool so every tool's callback is wrapped with the
// audit logger. Done in-place rather than passing a wrapped reference because
// the registration helpers call server.registerTool directly.
server.registerTool = makeAccessGatedRegister(server, config.accessLevel, {
  mode: config.auditLogMode,
  path: config.auditLogPath,
  maxBytes: config.auditLogMaxBytes,
  keep: config.auditLogKeep
})

registerKbTools(server, config)
registerConfigTools(server, config)

// No per-root accessibility check here: loadConfig() already refused to return
// unless every declared alias resolves to an existing directory, so reaching
// this point means the whole declaration is good.
const main = async (): Promise<void> => {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('mcp-ki-kb-fs ready')
}

main().catch((err) => {
  console.error('mcp-ki-kb-fs fatal:', err)
  process.exit(1)
})
