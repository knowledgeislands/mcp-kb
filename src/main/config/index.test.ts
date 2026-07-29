import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { KnowledgeBase } from '../../config/index.js'
import { kbConfigResultSchema, readKbConfig } from './index.js'

const ROOT_PATH = path.join(os.tmpdir(), 'knowledgeislands-tests', `config-${process.pid}`)

const base = (overrides: Partial<KnowledgeBase> = {}): KnowledgeBase => ({
  alias: 'primary',
  rootPath: ROOT_PATH,
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
  kiConfigRaw: null,
  ...overrides
})

beforeAll(async () => {
  await fs.mkdir(ROOT_PATH, { recursive: true })
})

afterAll(async () => {
  await fs.rm(ROOT_PATH, { recursive: true, force: true })
})

describe('readKbConfig', () => {
  it('returns default zones when kiConfigRaw is null', () => {
    const result = readKbConfig(base(), [base()])
    const parsed = result
    expect(parsed.zones).toEqual({
      Calendar: 'Calendar',
      Pillars: 'Pillars',
      Resources: 'Resources',
      Streams: 'Streams',
      Admin: 'Admin'
    })
    expect(parsed.staging).toEqual({ inbound: '+', outbound: '-' })
    expect(parsed.rootFileAllowlist).toEqual(['README.md', 'AGENTS.md', 'CLAUDE.md'])
    expect(parsed.kiConfigPresent).toBe(false)
    expect(parsed.kiConfigRaw).toBe('(absent — all zones are defaults)')
  })

  it('returns kiConfigPresent: true and raw content when kiConfigRaw is set', () => {
    const raw = '[knowledgeislands-kb]\n[knowledgeislands-kb.zones]\nCalendar = "Cal"\n'
    const result = readKbConfig(
      base({
        kiConfigRaw: raw,
        zones: {
          Calendar: 'Cal',
          Pillars: 'Pillars',
          Resources: 'Resources',
          Streams: 'Streams',
          Admin: 'Admin',
          inbound: '+',
          outbound: '-'
        }
      }),
      [base()]
    )
    const parsed = result
    expect(parsed.kiConfigPresent).toBe(true)
    expect(parsed.kiConfigRaw).toBe(raw)
    expect(parsed.zones.Calendar).toBe('Cal')
  })

  it('returns a value that satisfies the declared kb_config outputSchema', () => {
    // The schema is what the tool advertises as `outputSchema` and what the
    // handler emits as `structuredContent`; parsing here is what stops the two
    // from drifting apart.
    expect(() => kbConfigResultSchema.parse(readKbConfig(base(), [base()]))).not.toThrow()
  })

  it('exposes staging areas inbound and outbound separately from zones', () => {
    const result = readKbConfig(
      base({
        zones: {
          Calendar: 'Calendar',
          Pillars: 'Pillars',
          Resources: 'Resources',
          Streams: 'Streams',
          Admin: 'Admin',
          inbound: 'inbox',
          outbound: 'outbox'
        }
      }),
      [base()]
    )
    const parsed = result
    expect(parsed.staging.inbound).toBe('inbox')
    expect(parsed.staging.outbound).toBe('outbox')
    // zones object does not include inbound/outbound — the cast is what lets us
    // assert absence of keys the result type (and outputSchema) already excludes.
    const zones = parsed.zones as Record<string, string | undefined>
    expect(zones.inbound).toBeUndefined()
    expect(zones.outbound).toBeUndefined()
  })

  it('includes the exact root-file allow-list separately from zones', () => {
    const result = readKbConfig(base({ rootFileAllowlist: ['README.md', '.github/copilot-instructions.md'] }), [base()])
    const parsed = result
    expect(parsed.rootFileAllowlist).toEqual(['README.md', '.github/copilot-instructions.md'])
  })
})
