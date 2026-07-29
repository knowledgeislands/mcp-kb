/**
 * Tool-layer contract tests.
 *
 * `src/main/` returns plain data and throws; this layer is the only place that
 * knows about the MCP wire format. These tests pin the three things that makes
 * true: every tool declares an `outputSchema`, a success maps to a
 * `structuredContent` envelope that validates against that very schema, and a
 * `main/` throw is caught and mapped to an `isError` envelope rather than being
 * allowed to escape as a protocol error (which would bypass the audit wrapper).
 */
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ZodType } from 'zod'
import type { Config } from '../../config/index.js'
import { registerConfigTools } from '../config/index.js'
import { registerKbTools } from './index.js'

const ROOT_PATH = path.join(os.tmpdir(), 'knowledgeislands-tests', `tools-kb-${process.pid}`)
const ZONE = 'Pillars'

const cfg: Config = {
  rootPath: ROOT_PATH,
  accessLevel: 'destructive',
  auditLogMode: 'off',
  auditLogPath: path.join(ROOT_PATH, '.audit.jsonl'),
  auditLogMaxBytes: 0,
  auditLogKeep: 0,
  zones: {
    Calendar: 'Calendar',
    Pillars: 'Pillars',
    Resources: 'Resources',
    Streams: 'Streams',
    Admin: 'Admin',
    inbound: '+',
    outbound: '-'
  },
  rootFileAllowlist: ['README.md', 'AGENTS.md', 'CLAUDE.md'],
  kiConfigRaw: null
}

type ToolEnvelope = {
  isError?: boolean
  structuredContent?: unknown
  content: { type: string; text: string }[]
}

type Registered = {
  name: string
  config: { outputSchema?: ZodType }
  handler: (args: Record<string, unknown>) => ToolEnvelope | Promise<ToolEnvelope>
}

/** Capture what a `registerXxxTools` function registers, without a real server. */
const capture = (register: (server: McpServer, cfg: Config) => void): Registered[] => {
  const tools: Registered[] = []
  const server = {
    registerTool: (name: string, config: Registered['config'], handler: Registered['handler']) => {
      tools.push({ name, config, handler })
    }
  } as unknown as McpServer
  register(server, cfg)
  return tools
}

const allTools = (): Registered[] => [...capture(registerConfigTools), ...capture(registerKbTools)]

const byName = (name: string): Registered => {
  const found = allTools().find((tool) => tool.name === name)
  if (!found) throw new Error(`no tool registered as "${name}"`)
  return found
}

beforeAll(async () => {
  await fs.mkdir(path.join(ROOT_PATH, ZONE), { recursive: true })
  await fs.writeFile(path.join(ROOT_PATH, ZONE, 'Note.md'), '---\ntitle: T\n---\n# Body\n', 'utf-8')
})

afterAll(async () => {
  await fs.rm(ROOT_PATH, { recursive: true, force: true })
})

describe('tool surface', () => {
  it('registers exactly the seven documented tools', () => {
    expect(allTools().map((tool) => tool.name)).toEqual(['kb_config', 'kb_delete', 'kb_folder_create', 'kb_list', 'kb_read', 'kb_rename', 'kb_write'])
  })

  it('registers tools in ascending alphabetical order within each group', () => {
    for (const register of [registerConfigTools, registerKbTools]) {
      const names = capture(register).map((tool) => tool.name)
      expect(names).toEqual([...names].sort())
    }
  })

  it('declares an outputSchema for every tool', () => {
    for (const tool of allTools()) {
      expect(tool.config.outputSchema, `${tool.name} must declare an outputSchema`).toBeDefined()
    }
  })
})

describe('envelope mapping', () => {
  it('maps a successful call to structuredContent matching the declared outputSchema', async () => {
    for (const [name, args] of [
      ['kb_config', {}],
      ['kb_read', { path: `${ZONE}/Note.md`, part: 'all' }],
      ['kb_list', { path: ZONE, kind: 'files', recursive: false }],
      ['kb_write', { path: `${ZONE}/New.md`, content: 'x', encoding: 'utf-8', create_dirs: true, dry_run: true }],
      ['kb_delete', { path: `${ZONE}/Note.md`, dry_run: true }],
      ['kb_folder_create', { path: `${ZONE}/Sub` }]
    ] as const) {
      const tool = byName(name)
      const result = await tool.handler(args as Record<string, unknown>)

      expect(result.isError, `${name} should not error`).toBeUndefined()
      expect(result.structuredContent).toBeDefined()
      // The advertised schema and the emitted object are the same shape.
      expect(() => tool.config.outputSchema?.parse(result.structuredContent)).not.toThrow()
      // The text block carries the identical payload for clients that ignore
      // structuredContent.
      expect(JSON.parse(result.content[0]?.text ?? '')).toEqual(result.structuredContent)
    }
  })

  it('maps kb_rename success to a from/to envelope', async () => {
    const result = await byName('kb_rename').handler({ from: `${ZONE}/Note.md`, to: `${ZONE}/Moved.md`, create_dirs: true })

    expect(result.isError).toBeUndefined()
    expect(result.structuredContent).toEqual({ from: `${ZONE}/Note.md`, to: `${ZONE}/Moved.md` })
  })

  it('catches a main/ throw and returns an isError envelope instead of propagating', async () => {
    for (const [name, args, action] of [
      ['kb_read', { path: `${ZONE}/missing.md`, part: 'all' }, 'reading file'],
      ['kb_list', { path: 'NotAZone', kind: 'files', recursive: false }, 'listing content'],
      ['kb_write', { path: 'NotAZone/x.md', content: 'x', create_dirs: true, dry_run: false }, 'writing file'],
      ['kb_rename', { from: `${ZONE}/missing.md`, to: `${ZONE}/other.md`, create_dirs: true }, 'renaming file'],
      ['kb_delete', { path: `${ZONE}/missing.md`, dry_run: false }, 'deleting file'],
      ['kb_folder_create', { path: 'NotAZone/Sub' }, 'creating folder']
    ] as const) {
      const result = await byName(name).handler(args as Record<string, unknown>)

      expect(result.isError, `${name} should map the throw to isError`).toBe(true)
      expect(result.content[0]?.text).toMatch(new RegExp(`^Error ${action}: `))
      expect(result.structuredContent).toBeUndefined()
    }
  })
})
