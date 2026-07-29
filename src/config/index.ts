/**
 * Configuration loading. `loadConfig()` reads the environment (optionally
 * hydrated from the package's `.env*` files) into a plain `Config` value that is
 * passed explicitly into every main call — so the same code runs as an MCP
 * server or from a standalone script. There is NO module-level config
 * singleton: nothing here is read at import time.
 */
import { strict as assert } from 'node:assert'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseToml } from 'smol-toml'

const expandHome = (p: string): string => {
  return p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p
}

/**
 * Package root, resolved from this module's own URL — NOT `process.cwd()`,
 * which is wherever the MCP host happened to launch `node dist/mcp-server/...`
 * from. Both layouts put this file two levels below the root
 * (`dist/config/index.js` and `src/config/index.ts`), so `../..` is correct
 * whether built or run from source.
 */
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * Hydrate `process.env` from the package's `.env*` files, mirroring the set and
 * precedence Bun auto-loads (highest first: `.env.local`, then
 * `.env.${NODE_ENV}` if NODE_ENV is set, then `.env`). `process.loadEnvFile`
 * never overwrites a key already present in `process.env`, so loading
 * highest-precedence first means earlier files win — and any value injected by
 * the host (e.g. the MCP client's `env` block) beats every file. Missing files
 * are skipped silently; under Bun this is largely redundant with its own
 * auto-load, which is fine.
 */
const hydrateEnvFromFiles = (): void => {
  const files = ['.env.local']
  if (process.env.NODE_ENV) files.push(`.env.${process.env.NODE_ENV}`)
  files.push('.env')
  for (const file of files) {
    try {
      process.loadEnvFile(path.join(PACKAGE_ROOT, file))
    } catch {
      // File absent or unreadable — skip; the value may come from the host env.
    }
  }
}

/**
 * Single ordinal access level. Each level implies all lower ones:
 *   `read`        — only readOnly tools registered.
 *   `write`       — readOnly + non-destructive mutations (create, send, toggle).
 *   `destructive` — everything, including delete / overwrite / prune.
 *
 * The gate uses ACCESS_LEVEL_RANK for ordinal comparison; a tool registers when
 * its derived level ≤ the configured level.
 */
export type AccessLevel = 'read' | 'write' | 'destructive'
export const ACCESS_LEVELS: readonly AccessLevel[] = ['read', 'write', 'destructive'] as const
export const ACCESS_LEVEL_RANK: Record<AccessLevel, number> = { read: 1, write: 2, destructive: 3 }

/**
 * Scope of tool invocations to record. Default `writes` logs any tool whose
 * derived level is not `read` (i.e. `write` or `destructive`); `all` adds
 * `read` too; `off` disables logging entirely (the wrapper short-circuits and
 * never opens the file).
 */
export type AuditLogMode = 'off' | 'writes' | 'all'

/**
 * The resolved zone map for a Knowledge Islands KB. Each canonical zone name
 * maps to its local folder name in this KB (may differ from the canonical name
 * if overridden in .ki-config.toml). Staging areas + and - are always present.
 */
export interface ResolvedZones {
  Calendar: string
  Pillars: string
  Resources: string
  Streams: string
  Admin: string
  inbound: string // default '+'
  outbound: string // default '-'
}

export const DEFAULT_ZONES: ResolvedZones = {
  Calendar: 'Calendar',
  Pillars: 'Pillars',
  Resources: 'Resources',
  Streams: 'Streams',
  Admin: 'Admin',
  inbound: '+',
  outbound: '-'
}

/**
 * Exact KB-relative files that may be read through `kb_read`.
 * Ordinary file and note tools remain restricted to declared KB zones.
 */
export const DEFAULT_ROOT_FILE_ALLOWLIST = ['README.md', 'AGENTS.md', 'CLAUDE.md'] as const

export interface Config {
  /** Absolute KB root. All paths resolve under it and are confined to it. */
  rootPath: string
  accessLevel: AccessLevel
  auditLogMode: AuditLogMode
  auditLogPath: string
  auditLogMaxBytes: number
  auditLogKeep: number
  /** Resolved zone → folder-name map, derived from .ki-config.toml or defaults. */
  zones: ResolvedZones
  /** Exact KB-relative paths readable through kb_read. */
  rootFileAllowlist: readonly string[]
  /** Raw .ki-config.toml text if present, null if absent. */
  kiConfigRaw: string | null
}

const parseAccessLevel = (raw: string | undefined): AccessLevel => {
  const v = raw?.trim()
  if (v === undefined || v === '') return 'read'
  if ((ACCESS_LEVELS as readonly string[]).includes(v)) return v as AccessLevel
  throw new Error(`Invalid MCP_KI_KB_FS_ACCESS_LEVEL="${raw}". Allowed: ${ACCESS_LEVELS.join(', ')}`)
}

const parseAuditLogMode = (raw: string | undefined): AuditLogMode => {
  const v = raw?.trim().toLowerCase()
  if (v === undefined || v === '') return 'writes'
  if (v === 'off' || v === 'writes' || v === 'all') return v
  throw new Error(`Invalid MCP_KI_KB_FS_AUDIT_LOG="${raw}" — expected one of: off, writes, all.`)
}

/**
 * Size-based rotation. After each append, if `audit.jsonl` exceeds
 * MCP_KI_KB_FS_AUDIT_LOG_MAX_BYTES (default 10 MiB), it's renamed to `audit.jsonl.1`
 * and older rotations shift up. MCP_KI_KB_FS_AUDIT_LOG_KEEP (default 5) controls
 * how many rotated files survive. Set MAX_BYTES=0 to disable rotation.
 */
const parseNonNegativeInt = (raw: string | undefined, fallback: number, varName: string): number => {
  if (raw === undefined || raw.trim() === '') return fallback
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`Invalid ${varName}="${raw}" — expected a non-negative integer.`)
  }
  return n
}

/**
 * Read .ki-config.toml from the KB root (synchronously, during startup) and
 * resolve the zone map. Returns defaults for any zone not declared.
 */
const isRootFileAllowlistPath = (value: string): boolean => {
  if (!value || value.trim() !== value || value.startsWith('/') || value.startsWith('~') || value.includes('\\') || value.includes('\0')) {
    return false
  }
  return value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

const parseRootFileAllowlist = (value: unknown): readonly string[] => {
  if (value === undefined) return [...DEFAULT_ROOT_FILE_ALLOWLIST]
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string' && isRootFileAllowlistPath(entry))) {
    throw new Error('.ki-config.toml root_file_allowlist must be an array of exact, non-empty KB-relative paths without traversal or backslashes.')
  }
  return [...value]
}

const loadKiConfig = (rootPath: string): { zones: ResolvedZones; rootFileAllowlist: readonly string[]; kiConfigRaw: string | null } => {
  const configPath = path.join(rootPath, '.ki-config.toml')
  let raw: string | null = null
  try {
    raw = fs.readFileSync(configPath, 'utf-8')
  } catch {
    // Absent or unreadable — proceed with defaults.
    return { zones: { ...DEFAULT_ZONES }, rootFileAllowlist: [...DEFAULT_ROOT_FILE_ALLOWLIST], kiConfigRaw: null }
  }

  let parsed: Record<string, unknown>
  try {
    parsed = parseToml(raw) as Record<string, unknown>
  } catch (err) {
    // smol-toml always throws an Error instance; String(err) is a defensive fallback.
    /* v8 ignore next */
    throw new Error(`.ki-config.toml parse error: ${err instanceof Error ? err.message : String(err)}`)
  }

  const kb = (parsed['knowledgeislands-kb'] ?? {}) as Record<string, unknown>
  const declared = (kb.zones ?? {}) as Record<string, unknown>

  const str = (v: unknown, fallback: string): string => (typeof v === 'string' && v.trim() ? v.trim() : fallback)

  return {
    zones: {
      Calendar: str(declared.Calendar, DEFAULT_ZONES.Calendar),
      Pillars: str(declared.Pillars, DEFAULT_ZONES.Pillars),
      Resources: str(declared.Resources, DEFAULT_ZONES.Resources),
      Streams: str(declared.Streams, DEFAULT_ZONES.Streams),
      Admin: str(declared.Admin, DEFAULT_ZONES.Admin),
      inbound: str(declared.inbound, DEFAULT_ZONES.inbound),
      outbound: str(declared.outbound, DEFAULT_ZONES.outbound)
    },
    rootFileAllowlist: parseRootFileAllowlist(kb.root_file_allowlist),
    kiConfigRaw: raw
  }
}

/**
 * Load configuration from `env` (defaults to `process.env`, after attempting to
 * hydrate it from the package's `.env*` files). Throws if a required var is
 * missing.
 */
export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config => {
  hydrateEnvFromFiles()

  assert(env.MCP_KI_KB_FS_ROOT_PATH, 'MCP_KI_KB_FS_ROOT_PATH environment variable must be set')

  const rootPath = path.resolve(expandHome(env.MCP_KI_KB_FS_ROOT_PATH))
  const { zones, rootFileAllowlist, kiConfigRaw } = loadKiConfig(rootPath)

  return {
    rootPath,
    accessLevel: parseAccessLevel(env.MCP_KI_KB_FS_ACCESS_LEVEL),
    auditLogMode: parseAuditLogMode(env.MCP_KI_KB_FS_AUDIT_LOG),
    auditLogPath: path.resolve(expandHome(env.MCP_KI_KB_FS_AUDIT_LOG_PATH ?? path.join(os.homedir(), '.local', 'state', 'mcp-ki-kb-fs', 'audit.jsonl'))),
    auditLogMaxBytes: parseNonNegativeInt(env.MCP_KI_KB_FS_AUDIT_LOG_MAX_BYTES, 10 * 1024 * 1024, 'MCP_KI_KB_FS_AUDIT_LOG_MAX_BYTES'),
    auditLogKeep: parseNonNegativeInt(env.MCP_KI_KB_FS_AUDIT_LOG_KEEP, 5, 'MCP_KI_KB_FS_AUDIT_LOG_KEEP'),
    zones,
    rootFileAllowlist,
    kiConfigRaw
  }
}
