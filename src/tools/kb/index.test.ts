/**
 * Tool-layer contract tests.
 *
 * `src/main/` returns plain data and throws; this layer is the only place that
 * knows about the MCP wire format. These tests pin the three things that makes
 * true: every tool declares an `outputSchema`, a success maps to a
 * `structuredContent` envelope that validates against that very schema, and a
 * `main/` throw is caught and mapped to an `isError` envelope rather than being
 * allowed to escape as a protocol error (which would bypass the audit wrapper).
 *
 * They also pin the multi-base contract, which lives entirely in this layer:
 * every tool requires a `kb` alias, an undeclared alias is refused by argument
 * validation, and the alias a call names is the only base that call can touch.
 */
import * as fsSync from 'node:fs'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ZodType } from 'zod'
import { type Config, KNOWLEDGE_BASES_ENV_VAR, loadConfig } from '../../config/index.js'
import { registerConfigTools } from '../config/index.js'
import { registerKbTools } from './index.js'

const ALPHA_ROOT = path.join(os.tmpdir(), 'knowledgeislands-tests', `tools-kb-alpha-${process.pid}`)
const BETA_ROOT = path.join(os.tmpdir(), 'knowledgeislands-tests', `tools-kb-beta-${process.pid}`)
const ZONE = 'Pillars'

// Two bases, declared the way an install declares them: loadConfig validates the
// whole declaration up front, so the roots must exist before it is called.
fsSync.mkdirSync(path.join(ALPHA_ROOT, ZONE), { recursive: true })
fsSync.mkdirSync(path.join(BETA_ROOT, ZONE), { recursive: true })

const cfg: Config = loadConfig({
  [KNOWLEDGE_BASES_ENV_VAR]: JSON.stringify({ alpha: ALPHA_ROOT, beta: BETA_ROOT }),
  MCP_KI_KB_FS_ACCESS_LEVEL: 'destructive',
  MCP_KI_KB_FS_AUDIT_LOG: 'off'
})

type ToolEnvelope = {
  isError?: boolean
  structuredContent?: unknown
  content: { type: string; text: string }[]
}

type Registered = {
  name: string
  config: { inputSchema?: ZodType; outputSchema?: ZodType }
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

/** Minimal valid arguments per tool, for schema-level assertions. */
const SAMPLE_ARGS: Record<string, Record<string, unknown>> = {
  kb_config: {},
  kb_delete: { path: `${ZONE}/Note.md` },
  kb_folder_create: { path: `${ZONE}/Sub` },
  kb_list: { path: ZONE },
  kb_read: { path: `${ZONE}/Note.md` },
  kb_rename: { from: `${ZONE}/Note.md`, to: `${ZONE}/Moved.md` },
  kb_write: { path: `${ZONE}/Note.md`, content: 'x' }
}

beforeAll(async () => {
  await fs.writeFile(path.join(ALPHA_ROOT, ZONE, 'Note.md'), '---\ntitle: T\n---\n# Body\n', 'utf-8')
})

afterAll(async () => {
  await fs.rm(ALPHA_ROOT, { recursive: true, force: true })
  await fs.rm(BETA_ROOT, { recursive: true, force: true })
})

describe('tool surface', () => {
  it('registers exactly the seven documented tools', () => {
    expect(allTools().map((tool) => tool.name)).toEqual([
      'kb_config',
      'kb_delete',
      'kb_folder_create',
      'kb_list',
      'kb_read',
      'kb_rename',
      'kb_write'
    ])
  })

  it('registers tools in ascending alphabetical order within a group', () => {
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

describe('kb selector', () => {
  it('requires kb on every tool — there is no default base', () => {
    for (const tool of allTools()) {
      const args = SAMPLE_ARGS[tool.name]
      expect(args, `${tool.name} needs sample args`).toBeDefined()

      // Same args, with and without the selector: only the latter validates.
      expect(
        tool.config.inputSchema?.safeParse({ ...args, kb: 'alpha' }).success,
        `${tool.name} should accept kb`
      ).toBe(true)
      expect(tool.config.inputSchema?.safeParse(args).success, `${tool.name} must require kb`).toBe(false)
    }
  })

  it('refuses an undeclared alias during argument validation, before any handler runs', () => {
    for (const tool of allTools()) {
      const result = tool.config.inputSchema?.safeParse({ ...SAMPLE_ARGS[tool.name], kb: 'not-declared' })
      expect(result?.success, `${tool.name} must refuse an undeclared alias`).toBe(false)
    }
  })

  it('advertises exactly the declared aliases in every input schema', () => {
    for (const tool of allTools()) {
      const args = SAMPLE_ARGS[tool.name]
      expect(tool.config.inputSchema?.safeParse({ ...args, kb: 'alpha' }).success, `${tool.name} / alpha`).toBe(true)
      expect(tool.config.inputSchema?.safeParse({ ...args, kb: 'beta' }).success, `${tool.name} / beta`).toBe(true)
    }
  })
})

describe('envelope mapping', () => {
  it('maps a successful call to structuredContent matching the declared outputSchema', async () => {
    for (const [name, args] of [
      ['kb_config', { kb: 'alpha' }],
      ['kb_read', { kb: 'alpha', path: `${ZONE}/Note.md`, part: 'all' }],
      ['kb_list', { kb: 'alpha', path: ZONE, kind: 'files', recursive: false }],
      [
        'kb_write',
        { kb: 'alpha', path: `${ZONE}/New.md`, content: 'x', encoding: 'utf-8', create_dirs: true, dry_run: false }
      ],
      ['kb_delete', { kb: 'alpha', path: `${ZONE}/New.md`, dry_run: true }],
      ['kb_folder_create', { kb: 'alpha', path: `${ZONE}/Sub` }]
    ] as const) {
      const tool = byName(name)
      const result = await tool.handler(args as Record<string, unknown>)

      expect(result.isError, `${name} should not error`).toBeUndefined()
      expect(result.structuredContent).toBeDefined()
      expect(
        () => tool.config.outputSchema?.parse(result.structuredContent),
        `${name} structuredContent must match outputSchema`
      ).not.toThrow()
      expect(JSON.parse(result.content[0]?.text ?? '')).toEqual(result.structuredContent)
    }
  })

  it('returns the renamed from/to pair on a successful rename', async () => {
    const result = await byName('kb_rename').handler({
      kb: 'alpha',
      from: `${ZONE}/Note.md`,
      to: `${ZONE}/Moved.md`,
      create_dirs: true
    })

    expect(result.isError).toBeUndefined()
    expect(result.structuredContent).toEqual({ from: `${ZONE}/Note.md`, to: `${ZONE}/Moved.md` })
  })

  it('catches a main/ throw and returns an isError envelope instead of propagating', async () => {
    for (const [name, args, action] of [
      ['kb_read', { kb: 'alpha', path: `${ZONE}/missing.md`, part: 'all' }, 'reading file'],
      ['kb_list', { kb: 'alpha', path: 'NotAZone', kind: 'files', recursive: false }, 'listing content'],
      [
        'kb_write',
        { kb: 'alpha', path: 'NotAZone/x.md', content: 'x', create_dirs: true, dry_run: false },
        'writing file'
      ],
      [
        'kb_rename',
        { kb: 'alpha', from: `${ZONE}/missing.md`, to: `${ZONE}/other.md`, create_dirs: true },
        'renaming file'
      ],
      ['kb_delete', { kb: 'alpha', path: `${ZONE}/missing.md`, dry_run: false }, 'deleting file'],
      ['kb_folder_create', { kb: 'alpha', path: 'NotAZone/Sub' }, 'creating folder']
    ] as const) {
      const result = await byName(name).handler(args as Record<string, unknown>)

      expect(result.isError, `${name} should map a throw to isError`).toBe(true)
      expect(result.content[0]?.text).toMatch(new RegExp(`^Error ${action}: `))
      expect(result.structuredContent).toBeUndefined()
    }
  })
})

describe('base wiring — a call reaches only the base it names', () => {
  // The risk this covers is the one that only exists once several roots live in
  // one process: passing the wrong base's root together with the right base's
  // path. Both bases hold the same relative path with different content, so a
  // mis-wired handler returns the wrong bytes rather than an error.
  beforeAll(async () => {
    await fs.writeFile(path.join(ALPHA_ROOT, ZONE, 'Shared.md'), '# alpha content\n', 'utf-8')
    await fs.writeFile(path.join(BETA_ROOT, ZONE, 'Shared.md'), '# beta content\n', 'utf-8')
    await fs.writeFile(path.join(BETA_ROOT, ZONE, 'BetaOnly.md'), '# beta only\n', 'utf-8')
  })

  it('reads the named base’s copy of an identical relative path', async () => {
    const fromAlpha = await byName('kb_read').handler({ kb: 'alpha', path: `${ZONE}/Shared.md`, part: 'all' })
    const fromBeta = await byName('kb_read').handler({ kb: 'beta', path: `${ZONE}/Shared.md`, part: 'all' })

    expect((fromAlpha.structuredContent as { content: string }).content).toBe('# alpha content\n')
    expect((fromBeta.structuredContent as { content: string }).content).toBe('# beta content\n')
  })

  it('cannot see a file that exists only in the other declared base', async () => {
    const result = await byName('kb_read').handler({ kb: 'alpha', path: `${ZONE}/BetaOnly.md`, part: 'all' })

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('File not found')
  })

  it('lists only the named base’s entries', async () => {
    const alpha = await byName('kb_list').handler({ kb: 'alpha', path: ZONE, kind: 'files', recursive: false })
    const beta = await byName('kb_list').handler({ kb: 'beta', path: ZONE, kind: 'files', recursive: false })

    expect((alpha.structuredContent as { entries: string[] }).entries).not.toContain(`${ZONE}/BetaOnly.md`)
    expect((beta.structuredContent as { entries: string[] }).entries).toContain(`${ZONE}/BetaOnly.md`)
  })

  it('writes into the named base only, leaving the sibling untouched', async () => {
    const result = await byName('kb_write').handler({
      kb: 'beta',
      path: `${ZONE}/WrittenToBeta.md`,
      content: 'beta write',
      encoding: 'utf-8',
      create_dirs: true,
      dry_run: false
    })

    expect(result.isError).toBeUndefined()
    await expect(fs.readFile(path.join(BETA_ROOT, ZONE, 'WrittenToBeta.md'), 'utf-8')).resolves.toBe('beta write')
    await expect(fs.access(path.join(ALPHA_ROOT, ZONE, 'WrittenToBeta.md'))).rejects.toThrow()
  })
})

describe('kb_config across bases', () => {
  it('reports the selected alias plus the roster of every declared base', async () => {
    const result = await byName('kb_config').handler({ kb: 'beta' })
    const parsed = result.structuredContent as { kb: string; knowledgeBases: { kb: string }[] }

    expect(parsed.kb).toBe('beta')
    expect(parsed.knowledgeBases.map((entry) => entry.kb)).toEqual(['alpha', 'beta'])
  })

  it('never reports a filesystem path — bases are addressed by alias only', async () => {
    const result = await byName('kb_config').handler({ kb: 'alpha' })

    expect(result.content[0]?.text).not.toContain(ALPHA_ROOT)
    expect(result.content[0]?.text).not.toContain(BETA_ROOT)
  })
})
