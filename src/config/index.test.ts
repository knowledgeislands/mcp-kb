/**
 * loadConfig reads from the env object it's given, so tests pass explicit envs
 * (no process.env mutation, no module-reset dance). MCP_KI_KB_FS_ROOT_PATH is
 * required, so every load supplies it unless the test is asserting the guard.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isInScope, outOfScopeError } from '../utils/zones.js'
import { loadConfig } from './index.js'

const TOML_ROOT = path.join(os.tmpdir(), 'knowledgeislands-tests', `config-toml-${process.pid}`)

beforeAll(() => {
  fs.mkdirSync(TOML_ROOT, { recursive: true })
})

afterAll(() => {
  fs.rmSync(TOML_ROOT, { recursive: true, force: true })
})

const load = (extra: Record<string, string> = {}) => loadConfig({ MCP_KI_KB_FS_ROOT_PATH: '/tmp/explicit-kb', ...extra })

describe('loadConfig', () => {
  describe('rootPath (MCP_KI_KB_FS_ROOT_PATH)', () => {
    it('expands a leading ~/ to the user home directory', () => {
      expect(load({ MCP_KI_KB_FS_ROOT_PATH: '~/some-kb' }).rootPath).toBe(path.resolve(path.join(os.homedir(), 'some-kb')))
    })

    it('leaves an absolute path unchanged', () => {
      expect(load({ MCP_KI_KB_FS_ROOT_PATH: '/tmp/explicit-kb' }).rootPath).toBe('/tmp/explicit-kb')
    })

    it('throws when MCP_KI_KB_FS_ROOT_PATH is unset', () => {
      expect(() => loadConfig({})).toThrow(/MCP_KI_KB_FS_ROOT_PATH environment variable must be set/)
    })
  })

  describe('parseNonNegativeInt (via MCP_KI_KB_FS_AUDIT_LOG_MAX_BYTES)', () => {
    it('parses a valid integer string', () => {
      expect(load({ MCP_KI_KB_FS_AUDIT_LOG_MAX_BYTES: '2048' }).auditLogMaxBytes).toBe(2048)
    })

    it('defaults to 10 MiB when unset', () => {
      expect(load().auditLogMaxBytes).toBe(10 * 1024 * 1024)
    })

    it('throws on a non-numeric value', () => {
      expect(() => load({ MCP_KI_KB_FS_AUDIT_LOG_MAX_BYTES: 'oops' })).toThrow(/Invalid MCP_KI_KB_FS_AUDIT_LOG_MAX_BYTES="oops"/)
    })

    it('throws on a negative value', () => {
      expect(() => load({ MCP_KI_KB_FS_AUDIT_LOG_MAX_BYTES: '-1' })).toThrow(/Invalid MCP_KI_KB_FS_AUDIT_LOG_MAX_BYTES="-1"/)
    })

    it('defaults auditLogKeep to 5 and parses an override', () => {
      expect(load().auditLogKeep).toBe(5)
      expect(load({ MCP_KI_KB_FS_AUDIT_LOG_KEEP: '3' }).auditLogKeep).toBe(3)
    })
  })

  describe('accessLevel (MCP_KI_KB_FS_ACCESS_LEVEL)', () => {
    it('defaults to read when unset', () => {
      expect(load().accessLevel).toBe('read')
    })

    it('throws on unknown access level', () => {
      expect(() => load({ MCP_KI_KB_FS_ACCESS_LEVEL: 'godmode' })).toThrow(/Invalid MCP_KI_KB_FS_ACCESS_LEVEL="godmode"/)
    })

    it('accepts an explicit valid access level', () => {
      expect(load({ MCP_KI_KB_FS_ACCESS_LEVEL: 'write' }).accessLevel).toBe('write')
    })
  })

  describe('auditLogMode (MCP_KI_KB_FS_AUDIT_LOG)', () => {
    it('defaults to writes when unset', () => {
      expect(load().auditLogMode).toBe('writes')
    })

    it('throws on unknown audit log mode', () => {
      expect(() => load({ MCP_KI_KB_FS_AUDIT_LOG: 'maybe' })).toThrow(/Invalid MCP_KI_KB_FS_AUDIT_LOG="maybe"/)
    })

    it('accepts off / writes / all (case-insensitive)', () => {
      expect(load({ MCP_KI_KB_FS_AUDIT_LOG: 'OFF' }).auditLogMode).toBe('off')
      expect(load({ MCP_KI_KB_FS_AUDIT_LOG: 'all' }).auditLogMode).toBe('all')
    })
  })

  describe('auditLogPath (MCP_KI_KB_FS_AUDIT_LOG_PATH)', () => {
    it('defaults under ~/.local/state/mcp-ki-kb-fs', () => {
      expect(load().auditLogPath).toBe(path.join(os.homedir(), '.local', 'state', 'mcp-ki-kb-fs', 'audit.jsonl'))
    })

    it('expands ~/ and resolves an override', () => {
      expect(load({ MCP_KI_KB_FS_AUDIT_LOG_PATH: '~/logs/a.jsonl' }).auditLogPath).toBe(path.join(os.homedir(), 'logs', 'a.jsonl'))
    })
  })

  describe('hydrateEnvFromFiles (via loadConfig)', () => {
    // Every loadConfig call hydrates process.env from the package's `.env*`
    // files; that step branches on whether NODE_ENV is set. Exercise both arms.
    // Values still come from the explicit env literal, so the observable
    // contract is that hydration is NODE_ENV-agnostic and never throws.
    it('loads regardless of whether NODE_ENV is set', () => {
      const original = process.env.NODE_ENV
      try {
        process.env.NODE_ENV = 'production'
        expect(load().rootPath).toBe('/tmp/explicit-kb')
        delete process.env.NODE_ENV
        expect(load().rootPath).toBe('/tmp/explicit-kb')
      } finally {
        if (original === undefined) delete process.env.NODE_ENV
        else process.env.NODE_ENV = original
      }
    })
  })

  describe('loadKiConfig — .ki-config.toml handling', () => {
    it('uses zone overrides from a valid .ki-config.toml', () => {
      const toml = '[knowledgeislands-kb]\n[knowledgeislands-kb.zones]\nCalendar = "Cal"\n'
      fs.writeFileSync(path.join(TOML_ROOT, '.ki-config.toml'), toml, 'utf-8')
      const cfg = loadConfig({ MCP_KI_KB_FS_ROOT_PATH: TOML_ROOT })
      expect(cfg.zones.Calendar).toBe('Cal')
      expect(cfg.zones.Pillars).toBe('Pillars') // default
      expect(cfg.kiConfigRaw).toBe(toml)
      fs.rmSync(path.join(TOML_ROOT, '.ki-config.toml'))
    })

    it('uses the default root-file allow-list when .ki-config.toml has none', () => {
      const cfg = loadConfig({ MCP_KI_KB_FS_ROOT_PATH: TOML_ROOT })
      expect(cfg.rootFileAllowlist).toEqual(['README.md', 'AGENTS.md', 'CLAUDE.md'])
    })

    it('uses exact root-file allow-list paths from .ki-config.toml', () => {
      const toml = '[knowledgeislands-kb]\nroot_file_allowlist = ["README.md", "GEMINI.md", ".github/copilot-instructions.md"]\n'
      fs.writeFileSync(path.join(TOML_ROOT, '.ki-config.toml'), toml, 'utf-8')
      const cfg = loadConfig({ MCP_KI_KB_FS_ROOT_PATH: TOML_ROOT })
      expect(cfg.rootFileAllowlist).toEqual(['README.md', 'GEMINI.md', '.github/copilot-instructions.md'])
      fs.rmSync(path.join(TOML_ROOT, '.ki-config.toml'))
    })

    it('rejects non-relative or traversal paths in root_file_allowlist', () => {
      const toml = '[knowledgeislands-kb]\nroot_file_allowlist = ["../.env"]\n'
      fs.writeFileSync(path.join(TOML_ROOT, '.ki-config.toml'), toml, 'utf-8')
      expect(() => loadConfig({ MCP_KI_KB_FS_ROOT_PATH: TOML_ROOT })).toThrow(/root_file_allowlist must be an array/)
      fs.rmSync(path.join(TOML_ROOT, '.ki-config.toml'))
    })

    it('rejects every malformed shape of a root_file_allowlist entry', () => {
      // One case per guard arm in isRootFileAllowlistPath: empty, untrimmed, absolute,
      // home-relative, backslash, NUL, empty segment, and a "." segment.
      const bad = ['""', '" README.md"', '"/etc/passwd"', '"~/secrets.md"', '"a\\\\b.md"', '"a\\u0000b.md"', '"a//b.md"', '"./README.md"']
      for (const entry of bad) {
        const toml = `[knowledgeislands-kb]\nroot_file_allowlist = [${entry}]\n`
        fs.writeFileSync(path.join(TOML_ROOT, '.ki-config.toml'), toml, 'utf-8')
        expect(() => loadConfig({ MCP_KI_KB_FS_ROOT_PATH: TOML_ROOT }), `entry ${entry}`).toThrow(/root_file_allowlist must be an array/)
      }
      fs.rmSync(path.join(TOML_ROOT, '.ki-config.toml'))
    })

    it('rejects a root_file_allowlist that is not an array of strings', () => {
      for (const value of ['"README.md"', '[42]']) {
        const toml = `[knowledgeislands-kb]\nroot_file_allowlist = ${value}\n`
        fs.writeFileSync(path.join(TOML_ROOT, '.ki-config.toml'), toml, 'utf-8')
        expect(() => loadConfig({ MCP_KI_KB_FS_ROOT_PATH: TOML_ROOT }), `value ${value}`).toThrow(/root_file_allowlist must be an array/)
      }
      fs.rmSync(path.join(TOML_ROOT, '.ki-config.toml'))
    })

    it('throws on a malformed .ki-config.toml (TOML parse error branch, lines 155-161)', () => {
      fs.writeFileSync(path.join(TOML_ROOT, '.ki-config.toml'), '[[invalid\n', 'utf-8')
      expect(() => loadConfig({ MCP_KI_KB_FS_ROOT_PATH: TOML_ROOT })).toThrow(/.ki-config.toml parse error/)
      fs.rmSync(path.join(TOML_ROOT, '.ki-config.toml'))
    })

    it('falls back to defaults when .ki-config.toml is absent', () => {
      const cfg = loadConfig({ MCP_KI_KB_FS_ROOT_PATH: TOML_ROOT })
      expect(cfg.zones.Calendar).toBe('Calendar')
      expect(cfg.kiConfigRaw).toBeNull()
    })

    it('uses default zone name when override is an empty string (str() fallback branch)', () => {
      // An empty-string zone value should fall through to the default (str() returns fallback).
      const toml = '[knowledgeislands-kb]\n[knowledgeislands-kb.zones]\nCalendar = ""\n'
      fs.writeFileSync(path.join(TOML_ROOT, '.ki-config.toml'), toml, 'utf-8')
      const cfg = loadConfig({ MCP_KI_KB_FS_ROOT_PATH: TOML_ROOT })
      expect(cfg.zones.Calendar).toBe('Calendar') // empty string → fallback
      fs.rmSync(path.join(TOML_ROOT, '.ki-config.toml'))
    })

    it('uses default zone name when override is a non-string (str() typeof branch)', () => {
      // A TOML integer value for a zone key should fall through to the default.
      const toml = '[knowledgeislands-kb]\n[knowledgeislands-kb.zones]\nCalendar = 42\n'
      fs.writeFileSync(path.join(TOML_ROOT, '.ki-config.toml'), toml, 'utf-8')
      const cfg = loadConfig({ MCP_KI_KB_FS_ROOT_PATH: TOML_ROOT })
      expect(cfg.zones.Calendar).toBe('Calendar') // non-string → fallback
      fs.rmSync(path.join(TOML_ROOT, '.ki-config.toml'))
    })

    it('uses all defaults when .ki-config.toml has no [knowledgeislands-kb] section (line 163 ?? branch)', () => {
      // No [knowledgeislands-kb] table → parsed['knowledgeislands-kb'] is undefined → ?? {} fires.
      const toml = '[other-section]\nfoo = "bar"\n'
      fs.writeFileSync(path.join(TOML_ROOT, '.ki-config.toml'), toml, 'utf-8')
      const cfg = loadConfig({ MCP_KI_KB_FS_ROOT_PATH: TOML_ROOT })
      expect(cfg.zones.Calendar).toBe('Calendar')
      expect(cfg.zones.Pillars).toBe('Pillars')
      fs.rmSync(path.join(TOML_ROOT, '.ki-config.toml'))
    })

    it('uses all defaults when [knowledgeislands-kb] has no zones key (line 164 ?? branch)', () => {
      // [knowledgeislands-kb] section exists but has no zones sub-table → kb.zones is undefined → ?? {} fires.
      const toml = '[knowledgeislands-kb]\nsome_key = "value"\n'
      fs.writeFileSync(path.join(TOML_ROOT, '.ki-config.toml'), toml, 'utf-8')
      const cfg = loadConfig({ MCP_KI_KB_FS_ROOT_PATH: TOML_ROOT })
      expect(cfg.zones.Calendar).toBe('Calendar')
      fs.rmSync(path.join(TOML_ROOT, '.ki-config.toml'))
    })
  })
})

describe('zones helpers', () => {
  const zones = {
    Calendar: 'Calendar',
    Pillars: 'Pillars',
    Resources: 'Resources',
    Streams: 'Streams',
    Admin: 'Admin',
    inbound: '+',
    outbound: '-'
  }

  it('isInScope returns false for an empty string (line 12 branch)', () => {
    expect(isInScope('', zones)).toBe(false)
  })

  it('isInScope returns true for a path inside a zone', () => {
    expect(isInScope('Pillars/note.md', zones)).toBe(true)
  })

  it('isInScope returns false for a path outside all zones', () => {
    expect(isInScope('UnknownZone/note.md', zones)).toBe(false)
  })

  it('outOfScopeError lists all zone names', () => {
    const msg = outOfScopeError(zones)
    expect(msg).toContain('Calendar')
    expect(msg).toContain('Pillars')
    expect(msg).toContain('+')
  })
})
