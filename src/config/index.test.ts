/**
 * loadConfig reads from the env object it's given, so tests pass explicit envs
 * (no process.env mutation, no module-reset dance). The knowledge-base
 * declaration is required and fully validated at load time, so every load
 * supplies a real directory unless the test is asserting a guard.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isInScope, outOfScopeError } from '../utils/zones.js'
import { type Config, KNOWLEDGE_BASES_ENV_VAR, knowledgeBaseAliases, loadConfig, selectKnowledgeBase } from './index.js'

const TOML_ROOT = path.join(os.tmpdir(), 'knowledgeislands-tests', `config-toml-${process.pid}`)
const SECOND_ROOT = path.join(os.tmpdir(), 'knowledgeislands-tests', `config-second-${process.pid}`)

beforeAll(() => {
  fs.mkdirSync(TOML_ROOT, { recursive: true })
  fs.mkdirSync(SECOND_ROOT, { recursive: true })
})

afterAll(() => {
  fs.rmSync(TOML_ROOT, { recursive: true, force: true })
  fs.rmSync(SECOND_ROOT, { recursive: true, force: true })
})

/** Declare one or more bases the way an install's `env` block would. */
const declare = (bases: Record<string, string>): Record<string, string> => ({ [KNOWLEDGE_BASES_ENV_VAR]: JSON.stringify(bases) })

const load = (extra: Record<string, string> = {}) => loadConfig({ ...declare({ primary: TOML_ROOT }), ...extra })

/** The base under the default single-alias declaration. */
const primary = (cfg: Config) => selectKnowledgeBase(cfg, 'primary')

const loadDeclared = (bases: Record<string, string>) => loadConfig(declare(bases))

/** Raw (possibly malformed) declaration text, bypassing JSON.stringify. */
const loadRaw = (raw: string) => () => loadConfig({ [KNOWLEDGE_BASES_ENV_VAR]: raw })

describe('loadConfig', () => {
  describe(`knowledge-base declaration (${KNOWLEDGE_BASES_ENV_VAR})`, () => {
    it('resolves every declared alias to its own root, in declaration order', () => {
      const cfg = loadDeclared({ 'kit-pkb': TOML_ROOT, 'kit-legal': SECOND_ROOT })

      expect(knowledgeBaseAliases(cfg)).toEqual(['kit-pkb', 'kit-legal'])
      expect(selectKnowledgeBase(cfg, 'kit-pkb').rootPath).toBe(TOML_ROOT)
      expect(selectKnowledgeBase(cfg, 'kit-legal').rootPath).toBe(SECOND_ROOT)
      expect(selectKnowledgeBase(cfg, 'kit-legal').alias).toBe('kit-legal')
    })

    it('leaves an absolute path unchanged', () => {
      expect(primary(load()).rootPath).toBe(TOML_ROOT)
    })

    it('expands a leading ~/ to the user home directory', () => {
      // `~/` alone expands to the home directory itself — an existing directory,
      // so startup validation passes without planting a fixture in $HOME.
      expect(primary(loadDeclared({ primary: '~/' })).rootPath).toBe(path.resolve(os.homedir()))
    })

    it('throws when the declaration is unset or blank', () => {
      expect(() => loadConfig({})).toThrow(new RegExp(`${KNOWLEDGE_BASES_ENV_VAR} must be set to a JSON object`))
      expect(loadRaw('   ')).toThrow(new RegExp(`${KNOWLEDGE_BASES_ENV_VAR} must be set to a JSON object`))
    })

    it('throws when the declaration is not valid JSON', () => {
      expect(loadRaw('{kit-pkb: /tmp}')).toThrow(new RegExp(`${KNOWLEDGE_BASES_ENV_VAR} is not valid JSON`))
    })

    it('throws when the declaration is not a JSON object', () => {
      for (const raw of ['[]', 'null', '3', '"/tmp/kb"']) {
        expect(loadRaw(raw), `declaration ${raw}`).toThrow(new RegExp(`${KNOWLEDGE_BASES_ENV_VAR} must be a JSON object`))
      }
    })

    it('throws when an alias does not map to a path string', () => {
      expect(loadRaw('{"kit-pkb":42}')).toThrow(/alias "kit-pkb" must map to a path string/)
      expect(loadRaw('{"kit-pkb":{"path":"/tmp"}}')).toThrow(/alias "kit-pkb" must map to a path string/)
    })

    it('throws when the same alias is declared twice', () => {
      // JSON.parse keeps only the last of two identical keys, so a duplicate
      // would otherwise silently pick a winner — for a base the caller believes
      // points somewhere else.
      expect(loadRaw(`{"kit-pkb":${JSON.stringify(TOML_ROOT)},"kit-pkb":${JSON.stringify(SECOND_ROOT)}}`)).toThrow(/declares alias "kit-pkb" more than once/)
    })

    it('throws when a declared path is also a declared value elsewhere but no alias repeats', () => {
      // Guards the duplicate scan's key/value alternation: "b" appears as both a
      // value and a later key, which must NOT read as a repeated alias.
      const cfg = loadRaw(`{"a":${JSON.stringify(TOML_ROOT)},${JSON.stringify(TOML_ROOT)}:${JSON.stringify(SECOND_ROOT)}}`)
      expect(cfg).toThrow(/is not a safe identifier/)
    })

    it('throws when no knowledge base is declared', () => {
      expect(loadRaw('{}')).toThrow(/must declare at least one knowledge base/)
    })

    it('throws when an alias is not a safe identifier', () => {
      for (const alias of ['', '_private', '.hidden', '-dash', 'has space', 'has/slash', '..', '__proto__', 'a'.repeat(65)]) {
        expect(loadRaw(`{${JSON.stringify(alias)}:${JSON.stringify(TOML_ROOT)}}`), `alias ${alias}`).toThrow(/is not a safe identifier/)
      }
    })

    it('accepts aliases with dots, dashes, underscores and digits', () => {
      const cfg = loadDeclared({ 'kit-kris.me.uk': TOML_ROOT, kb_2: SECOND_ROOT })
      expect(knowledgeBaseAliases(cfg)).toEqual(['kit-kris.me.uk', 'kb_2'])
    })

    it('throws when a declared path is empty', () => {
      expect(loadRaw('{"kit-pkb":"   "}')).toThrow(/alias "kit-pkb" declares an empty path/)
    })

    it('throws when a declared path is relative', () => {
      // A relative root would resolve against the host's launch directory, which
      // would make the authorisation boundary depend on ambient state.
      expect(loadRaw('{"kit-pkb":"relative/kb"}')).toThrow(/must declare an absolute path or one starting "~\/"/)
    })

    it('throws when a declared path does not exist — at startup, not on first call', () => {
      expect(loadRaw(`{"kit-pkb":${JSON.stringify(path.join(TOML_ROOT, 'no-such-kb'))}}`)).toThrow(/points at a path that does not exist/)
    })

    it('throws when a declared path is not a directory', () => {
      const filePath = path.join(TOML_ROOT, 'not-a-directory')
      fs.writeFileSync(filePath, 'x', 'utf-8')
      try {
        expect(loadRaw(`{"kit-pkb":${JSON.stringify(filePath)}}`)).toThrow(/points at something that is not a directory/)
      } finally {
        fs.rmSync(filePath)
      }
    })

    it('resolves each base\u2019s own .ki-config.toml once, at startup', () => {
      fs.writeFileSync(path.join(SECOND_ROOT, '.ki-config.toml'), '[knowledgeislands-kb]\n[knowledgeislands-kb.zones]\nPillars = "Areas"\n', 'utf-8')
      try {
        const cfg = loadDeclared({ first: TOML_ROOT, second: SECOND_ROOT })

        expect(selectKnowledgeBase(cfg, 'first').zones.Pillars).toBe('Pillars')
        expect(selectKnowledgeBase(cfg, 'second').zones.Pillars).toBe('Areas')
      } finally {
        fs.rmSync(path.join(SECOND_ROOT, '.ki-config.toml'))
      }
    })
  })

  describe('selectKnowledgeBase', () => {
    it('returns the base declared under that alias', () => {
      const cfg = loadDeclared({ first: TOML_ROOT, second: SECOND_ROOT })
      expect(selectKnowledgeBase(cfg, 'second').rootPath).toBe(SECOND_ROOT)
    })

    it('refuses an undeclared alias outright rather than defaulting to a base', () => {
      const cfg = loadDeclared({ first: TOML_ROOT, second: SECOND_ROOT })
      expect(() => selectKnowledgeBase(cfg, 'third')).toThrow('Unknown knowledge base "third". Declared aliases: first, second')
    })

    it('refuses an inherited Object.prototype key as an alias', () => {
      // The declaration is held in a Map, so a lookup can never fall through to
      // a prototype property even before the alias pattern rejects the name.
      const cfg = loadDeclared({ first: TOML_ROOT })
      expect(() => selectKnowledgeBase(cfg, 'constructor')).toThrow(/Unknown knowledge base "constructor"/)
      expect(() => selectKnowledgeBase(cfg, '__proto__')).toThrow(/Unknown knowledge base "__proto__"/)
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
        expect(primary(load()).rootPath).toBe(TOML_ROOT)
        delete process.env.NODE_ENV
        expect(primary(load()).rootPath).toBe(TOML_ROOT)
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
      const cfg = primary(load())
      expect(cfg.zones.Calendar).toBe('Cal')
      expect(cfg.zones.Pillars).toBe('Pillars') // default
      expect(cfg.kiConfigRaw).toBe(toml)
      fs.rmSync(path.join(TOML_ROOT, '.ki-config.toml'))
    })

    it('uses the default root-file allow-list when .ki-config.toml has none', () => {
      const cfg = primary(load())
      expect(cfg.rootFileAllowlist).toEqual(['README.md', 'AGENTS.md', 'CLAUDE.md'])
    })

    it('uses exact root-file allow-list paths from .ki-config.toml', () => {
      const toml = '[knowledgeislands-kb]\nroot_file_allowlist = ["README.md", "GEMINI.md", ".github/copilot-instructions.md"]\n'
      fs.writeFileSync(path.join(TOML_ROOT, '.ki-config.toml'), toml, 'utf-8')
      const cfg = primary(load())
      expect(cfg.rootFileAllowlist).toEqual(['README.md', 'GEMINI.md', '.github/copilot-instructions.md'])
      fs.rmSync(path.join(TOML_ROOT, '.ki-config.toml'))
    })

    it('rejects non-relative or traversal paths in root_file_allowlist', () => {
      const toml = '[knowledgeislands-kb]\nroot_file_allowlist = ["../.env"]\n'
      fs.writeFileSync(path.join(TOML_ROOT, '.ki-config.toml'), toml, 'utf-8')
      expect(() => load()).toThrow(/root_file_allowlist must be an array/)
      fs.rmSync(path.join(TOML_ROOT, '.ki-config.toml'))
    })

    it('rejects every malformed shape of a root_file_allowlist entry', () => {
      // One case per guard arm in isRootFileAllowlistPath: empty, untrimmed, absolute,
      // home-relative, backslash, NUL, empty segment, and a "." segment.
      const bad = ['""', '" README.md"', '"/etc/passwd"', '"~/secrets.md"', '"a\\\\b.md"', '"a\\u0000b.md"', '"a//b.md"', '"./README.md"']
      for (const entry of bad) {
        const toml = `[knowledgeislands-kb]\nroot_file_allowlist = [${entry}]\n`
        fs.writeFileSync(path.join(TOML_ROOT, '.ki-config.toml'), toml, 'utf-8')
        expect(() => load(), `entry ${entry}`).toThrow(/root_file_allowlist must be an array/)
      }
      fs.rmSync(path.join(TOML_ROOT, '.ki-config.toml'))
    })

    it('rejects a root_file_allowlist that is not an array of strings', () => {
      for (const value of ['"README.md"', '[42]']) {
        const toml = `[knowledgeislands-kb]\nroot_file_allowlist = ${value}\n`
        fs.writeFileSync(path.join(TOML_ROOT, '.ki-config.toml'), toml, 'utf-8')
        expect(() => load(), `value ${value}`).toThrow(/root_file_allowlist must be an array/)
      }
      fs.rmSync(path.join(TOML_ROOT, '.ki-config.toml'))
    })

    it('throws on a malformed .ki-config.toml (TOML parse error branch, lines 155-161)', () => {
      fs.writeFileSync(path.join(TOML_ROOT, '.ki-config.toml'), '[[invalid\n', 'utf-8')
      expect(() => load()).toThrow(/.ki-config.toml parse error/)
      fs.rmSync(path.join(TOML_ROOT, '.ki-config.toml'))
    })

    it('falls back to defaults when .ki-config.toml is absent', () => {
      const cfg = primary(load())
      expect(cfg.zones.Calendar).toBe('Calendar')
      expect(cfg.kiConfigRaw).toBeNull()
    })

    it('uses default zone name when override is an empty string (str() fallback branch)', () => {
      // An empty-string zone value should fall through to the default (str() returns fallback).
      const toml = '[knowledgeislands-kb]\n[knowledgeislands-kb.zones]\nCalendar = ""\n'
      fs.writeFileSync(path.join(TOML_ROOT, '.ki-config.toml'), toml, 'utf-8')
      const cfg = primary(load())
      expect(cfg.zones.Calendar).toBe('Calendar') // empty string → fallback
      fs.rmSync(path.join(TOML_ROOT, '.ki-config.toml'))
    })

    it('uses default zone name when override is a non-string (str() typeof branch)', () => {
      // A TOML integer value for a zone key should fall through to the default.
      const toml = '[knowledgeislands-kb]\n[knowledgeislands-kb.zones]\nCalendar = 42\n'
      fs.writeFileSync(path.join(TOML_ROOT, '.ki-config.toml'), toml, 'utf-8')
      const cfg = primary(load())
      expect(cfg.zones.Calendar).toBe('Calendar') // non-string → fallback
      fs.rmSync(path.join(TOML_ROOT, '.ki-config.toml'))
    })

    it('uses all defaults when .ki-config.toml has no [knowledgeislands-kb] section (line 163 ?? branch)', () => {
      // No [knowledgeislands-kb] table → parsed['knowledgeislands-kb'] is undefined → ?? {} fires.
      const toml = '[other-section]\nfoo = "bar"\n'
      fs.writeFileSync(path.join(TOML_ROOT, '.ki-config.toml'), toml, 'utf-8')
      const cfg = primary(load())
      expect(cfg.zones.Calendar).toBe('Calendar')
      expect(cfg.zones.Pillars).toBe('Pillars')
      fs.rmSync(path.join(TOML_ROOT, '.ki-config.toml'))
    })

    it('uses all defaults when [knowledgeislands-kb] has no zones key (line 164 ?? branch)', () => {
      // [knowledgeislands-kb] section exists but has no zones sub-table → kb.zones is undefined → ?? {} fires.
      const toml = '[knowledgeislands-kb]\nsome_key = "value"\n'
      fs.writeFileSync(path.join(TOML_ROOT, '.ki-config.toml'), toml, 'utf-8')
      const cfg = primary(load())
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
