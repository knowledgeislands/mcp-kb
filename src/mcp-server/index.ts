#!/usr/bin/env node

/**
 * mcp-ki-kb-fs
 *
 * Local stdio MCP server providing zone-scoped read/write access to a
 * Knowledge Islands knowledge base on the local filesystem. All paths are
 * constrained to the declared KI zones (Calendar, Pillars, Resources, Streams,
 * Admin) and staging areas (+ inbound, - outbound), as resolved from
 * .ki-config.toml at startup.
 *
 * Configuration (environment variables):
 *   MCP_KI_KB_FS_ROOT_PATH    Absolute or ~ path to the knowledge base root.
 */

import * as fs from 'node:fs/promises'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { loadConfig } from '../config/index.js'
import { registerConfigTools, registerKbTools } from '../tools/index.js'
import { makeAccessGatedRegister } from '../utils/access-level.js'

const config = loadConfig()

console.error('mcp-ki-kb-fs starting...')
console.error(`  MCP_KI_KB_FS_ACCESS_LEVEL=${config.accessLevel}`)
console.error(`  MCP_KI_KB_FS_ROOT_PATH=${config.rootPath}`)
console.error(`  MCP_KI_KB_FS_AUDIT_LOG=${config.auditLogMode}${config.auditLogMode === 'off' ? '' : ` (path: ${config.auditLogPath})`}`)
console.error(`  zones=${Object.values(config.zones).join(', ')}`)

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

const main = async (): Promise<void> => {
  try {
    await fs.access(config.rootPath)
  } catch {
    console.error(`mcp-ki-kb-fs: MCP_KI_KB_FS_ROOT_PATH not accessible: ${config.rootPath}\nSet MCP_KI_KB_FS_ROOT_PATH to the correct path and restart.`)
    return
  }

  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('mcp-ki-kb-fs ready')
}

main().catch((err) => {
  console.error('mcp-ki-kb-fs fatal:', err)
  process.exit(1)
})
