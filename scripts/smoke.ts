#!/usr/bin/env node
// End-to-end smoke test: boot the built server over stdio MCP, list its tools,
// and assert the surface matches what the registration tests expect. Catches
// drift between code and the *wire* contract (registration tests cover the
// in-process registration call pattern; this covers the actual protocol round-trip).
//
// Run via `bun run test:smoke` (builds dist/ first). Runs in CI without secrets:
// the only required env var is the knowledge-base declaration, which we point at
// two throwaway temp directories so startup validation passes without any real
// knowledge base on disk. Two, not one, so the wire surface is checked to carry
// a genuine multi-base selector rather than a single-valued one.

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

// Single source of truth for the tool surface — kept in sync with the
// registrations in `src/tools/`. If you add a tool, update both.
const EXPECTED_TOOLS = [
  'kb_config',
  'kb_delete',
  'kb_folder_create',
  'kb_list',
  'kb_read',
  'kb_rename',
  'kb_write'
] as const

const ALIASES = ['smoke-alpha', 'smoke-beta'] as const

const die = (msg: string, detail?: unknown): never => {
  console.error(`✗ smoke failed: ${msg}`)
  if (detail !== undefined) console.error(detail)
  process.exit(1)
}

const main = async (): Promise<void> => {
  const roots = ALIASES.map((alias) => fs.mkdtempSync(path.join(os.tmpdir(), `${alias}-`)))
  const declaration = Object.fromEntries(ALIASES.map((alias, index) => [alias, roots[index] as string]))

  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/mcp-server/index.js'],
    // Raise the access level to `destructive` so the smoke test sees the full
    // surface; the server's default (read only) would otherwise hide every
    // mutating kb_* tool.
    env: {
      ...(process.env as Record<string, string>),
      MCP_KI_KB_FS_ACCESS_LEVEL: 'destructive',
      MCP_KI_KB_FS_KNOWLEDGE_BASES: JSON.stringify(declaration)
    }
  })
  const client = new Client({ name: 'mcp-kb-fs-smoke', version: '0.0.0' }, { capabilities: {} })

  await client.connect(transport)

  try {
    const { tools } = await client.listTools()
    const names = tools.map((t) => t.name).sort()
    const expected = [...EXPECTED_TOOLS].sort()

    // Diff with clear messages so CI logs are actionable.
    const missing = expected.filter((n) => !names.includes(n))
    const extra = names.filter((n) => !expected.includes(n as (typeof EXPECTED_TOOLS)[number]))
    if (missing.length || extra.length) {
      die('tool surface mismatch', { missing, extra, actualCount: names.length, expectedCount: expected.length })
    }

    // Sanity: every tool advertises an inputSchema object.
    const missingSchema = tools.filter((t) => !t.inputSchema || typeof t.inputSchema !== 'object').map((t) => t.name)
    if (missingSchema.length) die('tools missing inputSchema', missingSchema)

    // The multi-base contract, checked on the wire rather than in-process: every
    // tool must REQUIRE `kb`, and advertise exactly the declared aliases as its
    // permitted values. A tool that let `kb` default, or accepted a free-form
    // string, would pass the checks above and fail here.
    for (const tool of tools) {
      const schema = tool.inputSchema as { required?: unknown; properties?: Record<string, { enum?: unknown }> }
      const required = Array.isArray(schema.required) ? (schema.required as string[]) : []
      if (!required.includes('kb')) die(`${tool.name} does not require a kb argument`, schema)

      const declared = schema.properties?.kb?.enum
      if (!Array.isArray(declared)) die(`${tool.name} does not advertise kb as an enum of declared aliases`, schema)
      const advertised = [...(declared as string[])].sort()
      if (JSON.stringify(advertised) !== JSON.stringify([...ALIASES].sort())) {
        die(`${tool.name} advertises the wrong kb aliases`, { advertised, expected: ALIASES })
      }
    }

    console.error(`✓ smoke passed: ${names.length} tools listed, all schemas present, all requiring kb ∈ {${ALIASES.join(', ')}}`)
  } finally {
    await client.close()
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true })
  }
}

main().catch((err) => die('uncaught', err))
