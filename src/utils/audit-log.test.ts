import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { levelFromAnnotations, makeAccessGatedRegister } from './access-level.js'
import { DESTRUCTIVE, READ_ONLY } from './annotations.js'
import type { AuditConfig } from './audit-log.js'

describe('appendAuditEvent / withAuditLog (mcp-ki-kb-fs)', () => {
  const tmpDir = path.join(os.tmpdir(), 'mcp-ki-kb-fs-audit-log-tests', `run-${process.pid}-${Date.now()}`)
  const logPath = path.join(tmpDir, 'audit.jsonl')

  // The audit-log module keeps internal state (chmodEnsured, the append queue),
  // so reset modules per test for isolation. Config is passed in explicitly.
  const auditCfg = (o: Partial<AuditConfig> = {}): AuditConfig => ({
    mode: 'writes',
    path: logPath,
    maxBytes: 10 * 1024 * 1024,
    keep: 5,
    ...o
  })

  beforeEach(async () => {
    await fs.mkdir(tmpDir, { recursive: true })
    vi.resetModules()
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  const flushAsync = () => new Promise((r) => setTimeout(r, 20))

  it('appends an event line for a destructive-level tool', async () => {
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog(auditCfg(), 'kb_note_write', 'destructive', async () => ({
      content: [{ type: 'text', text: 'ok' }]
    }))
    await wrapped({ path: 'memo.md' })
    await flushAsync()
    const event = JSON.parse((await fs.readFile(logPath, 'utf-8')).trim())
    expect(event.tool).toBe('kb_note_write')
    expect(event.level).toBe('destructive')
    expect(event.ok).toBe(true)
    expect(event.server).toBe('mcp-ki-kb-fs')
    expect(event.args).toEqual({ path: 'memo.md' })
  })

  it('redacts the content field on writeNote-style args', async () => {
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog(auditCfg(), 'kb_note_write', 'destructive', async () => ({
      content: [{ type: 'text', text: 'ok' }]
    }))
    await wrapped({ path: 'memo.md', content: 'x'.repeat(5000) })
    await flushAsync()
    const event = JSON.parse((await fs.readFile(logPath, 'utf-8')).trim())
    expect(event.args.content).toMatch(/^\[redacted \d+B\]$/)
  })

  it('records ok:false when the result has isError:true', async () => {
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog(auditCfg(), 'kb_note_write', 'destructive', async () => ({
      isError: true,
      content: [{ type: 'text', text: 'boom' }]
    }))
    await wrapped({})
    await flushAsync()
    const event = JSON.parse((await fs.readFile(logPath, 'utf-8')).trim())
    expect(event.ok).toBe(false)
    expect(event.error).toBe('boom')
  })

  it('records ok:false when the handler throws', async () => {
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog(auditCfg(), 'kb_note_write', 'destructive', async () => {
      throw new Error('kaboom')
    })
    await expect(wrapped({})).rejects.toThrow(/kaboom/)
    await flushAsync()
    const event = JSON.parse((await fs.readFile(logPath, 'utf-8')).trim())
    expect(event.ok).toBe(false)
    expect(event.error).toBe('kaboom')
  })

  it('skips read-level tools by default (mode=writes)', async () => {
    const { withAuditLog } = await import('./audit-log.js')
    const handler = vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    const wrapped = withAuditLog(auditCfg(), 'kb_note_read', 'read', handler)
    expect(wrapped).toBe(handler)
  })

  it('logs read-level tools when audit mode is "all"', async () => {
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog(auditCfg({ mode: 'all' }), 'kb_note_read', 'read', async () => ({
      content: [{ type: 'text', text: 'ok' }]
    }))
    await wrapped({})
    await flushAsync()
    const event = JSON.parse((await fs.readFile(logPath, 'utf-8')).trim())
    expect(event.level).toBe('read')
  })

  it('skips both levels when audit mode is "off" and never creates a log file', async () => {
    const { withAuditLog } = await import('./audit-log.js')
    const writeHandler = vi.fn(async (_args: unknown) => ({ content: [{ type: 'text', text: 'ok' }] }))
    expect(withAuditLog(auditCfg({ mode: 'off' }), 'kb_note_write', 'destructive', writeHandler)).toBe(writeHandler)
    await writeHandler({})
    await flushAsync()
    await expect(fs.access(logPath)).rejects.toThrow()
  })

  it('creates the audit log with mode 0o600 and chmods an existing 0o644 log down to 0o600', async () => {
    await fs.mkdir(path.dirname(logPath), { recursive: true })
    await fs.writeFile(logPath, '', { mode: 0o644 })
    expect(((await fs.stat(logPath)).mode & 0o777).toString(8)).toBe('644')

    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog(auditCfg(), 'kb_note_write', 'destructive', async () => ({
      content: [{ type: 'text', text: 'ok' }]
    }))
    await wrapped({})
    await flushAsync()

    const mode = (await fs.stat(logPath)).mode & 0o777
    expect(mode.toString(8)).toBe('600')
  })

  it('truncates args when the serialized form exceeds MAX_ARG_CHARS', async () => {
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog(auditCfg(), 'kb_note_write', 'destructive', async () => ({
      content: [{ type: 'text', text: 'ok' }]
    }))
    // `content` gets redacted (short string), so use a different key with a huge value.
    await wrapped({ huge: 'x'.repeat(5000) })
    await flushAsync()
    const event = JSON.parse((await fs.readFile(logPath, 'utf-8')).trim())
    expect(event.args._truncated).toBe(true)
    expect(typeof event.args.preview).toBe('string')
  })

  it('logs array args verbatim (sanitizeArgs only rewrites plain objects)', async () => {
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog(auditCfg(), 'kb_note_write', 'destructive', async () => ({
      content: [{ type: 'text', text: 'ok' }]
    }))
    await wrapped([1, 2, 3])
    await flushAsync()
    const event = JSON.parse((await fs.readFile(logPath, 'utf-8')).trim())
    expect(event.args).toEqual([1, 2, 3])
  })

  it('redacts URL credentials across string, array, nested-object and primitive arg values', async () => {
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog(auditCfg(), 'kb_note_write', 'destructive', async () => ({
      content: [{ type: 'text', text: 'ok' }]
    }))
    await wrapped({
      url: 'https://user:tok3n@example.com/x',
      list: ['https://user:tok3n@example.com/y'],
      nested: { remote: 'https://user:tok3n@example.com/z' },
      count: 42
    })
    await flushAsync()
    const raw = (await fs.readFile(logPath, 'utf-8')).trim()
    expect(raw).not.toContain('tok3n')
    const event = JSON.parse(raw)
    expect(event.args.url).toBe('https://<redacted>@example.com/x')
    expect(event.args.list).toEqual(['https://<redacted>@example.com/y'])
    expect(event.args.nested.remote).toBe('https://<redacted>@example.com/z')
    expect(event.args.count).toBe(42)
  })

  it('records an error result that lacks a text content block (error stays undefined)', async () => {
    const { withAuditLog } = await import('./audit-log.js')
    // isError true but `content` is not an array, so extractErrorText returns undefined.
    const wrapped = withAuditLog(auditCfg(), 'kb_note_write', 'destructive', async () => ({ isError: true }) as never)
    await wrapped({})
    await flushAsync()
    const event = JSON.parse((await fs.readFile(logPath, 'utf-8')).trim())
    expect(event.ok).toBe(false)
    expect(event.error).toBeUndefined()
  })

  it('never rotates when maxBytes=0 (rotation disabled)', async () => {
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog(auditCfg({ maxBytes: 0 }), 'kb_note_write', 'destructive', async () => ({
      content: [{ type: 'text', text: 'ok' }]
    }))
    for (let i = 0; i < 6; i++) await wrapped({ idx: i, pad: 'x'.repeat(200) })
    await new Promise((r) => setTimeout(r, 50))
    // No rotation files exist; everything stayed in the single live log.
    await expect(fs.access(`${logPath}.1`)).rejects.toThrow()
    await expect(fs.access(logPath)).resolves.toBeUndefined()
  })

  it('rotates the audit log when it exceeds maxBytes (keeps history)', async () => {
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog(auditCfg({ maxBytes: 100, keep: 2 }), 'kb_note_write', 'destructive', async () => ({
      content: [{ type: 'text', text: 'ok' }]
    }))
    // Write enough events to trigger multiple rotations.
    for (let i = 0; i < 6; i++) await wrapped({ idx: i })
    await new Promise((r) => setTimeout(r, 50))
    await expect(fs.access(`${logPath}.1`)).resolves.toBeUndefined()
  })

  it('rotates by truncating the log when keep=0 (no history)', async () => {
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog(auditCfg({ maxBytes: 100, keep: 0 }), 'kb_note_write', 'destructive', async () => ({
      content: [{ type: 'text', text: 'ok' }]
    }))
    for (let i = 0; i < 6; i++) await wrapped({ idx: i })
    await new Promise((r) => setTimeout(r, 50))
    // No `.1` rotation file when keep=0.
    await expect(fs.access(`${logPath}.1`)).rejects.toThrow()
  })

  it('swallows rotation failures (e.g. destination slot is a non-empty dir) and leaves the live log', async () => {
    // keep=1: the shift loop is empty, so rotation goes straight to
    // `rename(live → .1)`. Pre-block `.1` with a non-empty directory so that
    // rename fails with ENOTEMPTY, exercising the rotateIfNeeded catch branch.
    await fs.mkdir(path.dirname(logPath), { recursive: true })
    await fs.mkdir(`${logPath}.1`, { recursive: true })
    await fs.writeFile(path.join(`${logPath}.1`, 'blocker'), 'x')
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog(auditCfg({ maxBytes: 100, keep: 1 }), 'kb_note_write', 'destructive', async () => ({
      content: [{ type: 'text', text: 'ok' }]
    }))
    for (let i = 0; i < 6; i++) await wrapped({ idx: i })
    await new Promise((r) => setTimeout(r, 50))
    // Rotation failed, so the live log still exists and the blocker dir is intact.
    await expect(fs.access(logPath)).resolves.toBeUndefined()
    await expect(fs.access(path.join(`${logPath}.1`, 'blocker'))).resolves.toBeUndefined()
  })

  it('swallows appendFile failures (e.g. path is a directory) without throwing', async () => {
    // Make the log path a directory so appendFile fails with EISDIR.
    await fs.mkdir(logPath, { recursive: true })
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog(auditCfg(), 'kb_note_write', 'destructive', async () => ({
      content: [{ type: 'text', text: 'ok' }]
    }))
    // Should NOT throw — appendAuditEvent catches all write errors.
    await expect(wrapped({})).resolves.toBeDefined()
  })
})

describe('levelFromAnnotations / makeAccessGatedRegister (mcp-ki-kb-fs)', () => {
  const auditOff: AuditConfig = { mode: 'off', path: '/tmp/unused-audit.jsonl', maxBytes: 0, keep: 0 }

  it('maps READ_ONLY annotations to read', () => {
    expect(levelFromAnnotations(READ_ONLY)).toBe('read')
  })

  it('maps DESTRUCTIVE annotations to destructive', () => {
    expect(levelFromAnnotations(DESTRUCTIVE)).toBe('destructive')
  })

  it('maps explicit non-destructive write annotations to write', () => {
    expect(
      levelFromAnnotations({ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false })
    ).toBe('write')
  })

  it('defaults to destructive (fail-safe) when annotations are missing', () => {
    expect(levelFromAnnotations(undefined)).toBe('destructive')
  })

  it('skips registration for tools whose level exceeds the gate (read gate)', () => {
    const registerTool = vi.fn()
    const fakeServer = { registerTool } as unknown as Parameters<typeof makeAccessGatedRegister>[0]
    const gated = makeAccessGatedRegister(fakeServer, 'read', auditOff)
    gated(
      'kb_note_read',
      { title: 't', description: 'd', annotations: READ_ONLY } as never,
      (async () => ({ content: [] })) as never
    )
    gated(
      'kb_note_write',
      { title: 't', description: 'd', annotations: DESTRUCTIVE } as never,
      (async () => ({ content: [] })) as never
    )
    expect(registerTool).toHaveBeenCalledTimes(1)
    expect((registerTool.mock.calls[0] as unknown[])[0]).toBe('kb_note_read')
  })

  it('registers read + non-destructive writes at the write gate (but not destructive ones)', () => {
    const registerTool = vi.fn()
    const fakeServer = { registerTool } as unknown as Parameters<typeof makeAccessGatedRegister>[0]
    const gated = makeAccessGatedRegister(fakeServer, 'write', auditOff)
    const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const
    gated(
      'kb_note_read',
      { title: 't', description: 'd', annotations: READ_ONLY } as never,
      (async () => ({ content: [] })) as never
    )
    gated(
      'kb_note_add',
      { title: 't', description: 'd', annotations: WRITE } as never,
      (async () => ({ content: [] })) as never
    )
    gated(
      'kb_note_delete',
      { title: 't', description: 'd', annotations: DESTRUCTIVE } as never,
      (async () => ({ content: [] })) as never
    )
    expect(registerTool).toHaveBeenCalledTimes(2)
    expect((registerTool.mock.calls[0] as unknown[])[0]).toBe('kb_note_read')
    expect((registerTool.mock.calls[1] as unknown[])[0]).toBe('kb_note_add')
  })

  it('registers all levels at the destructive gate', () => {
    const registerTool = vi.fn()
    const fakeServer = { registerTool } as unknown as Parameters<typeof makeAccessGatedRegister>[0]
    const gated = makeAccessGatedRegister(fakeServer, 'destructive', auditOff)
    gated(
      'kb_note_read',
      { title: 't', description: 'd', annotations: READ_ONLY } as never,
      (async () => ({ content: [] })) as never
    )
    gated(
      'kb_note_delete',
      { title: 't', description: 'd', annotations: DESTRUCTIVE } as never,
      (async () => ({ content: [] })) as never
    )
    expect(registerTool).toHaveBeenCalledTimes(2)
  })

  it('treats an unannotated tool as destructive (fail-safe)', () => {
    const registerTool = vi.fn()
    const fakeServer = { registerTool } as unknown as Parameters<typeof makeAccessGatedRegister>[0]
    const gated = makeAccessGatedRegister(fakeServer, 'read', auditOff)
    gated('unannotated_tool', { title: 't', description: 'd' } as never, (async () => ({ content: [] })) as never)
    // read gate → unannotated (treated as destructive) is skipped
    expect(registerTool).toHaveBeenCalledTimes(0)
  })
})
