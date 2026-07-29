import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { assertRealPathWithinRoot, errMessage, isNodeError, resolveWithinRoot } from './utils.js'

describe('resolveWithinRoot', () => {
  const root = '/tmp/kb-root'

  it('resolves a simple relative path inside the root', () => {
    expect(resolveWithinRoot(root, 'note.md')).toBe('/tmp/kb-root/note.md')
  })

  it('resolves a nested relative path', () => {
    expect(resolveWithinRoot(root, 'sub/dir/note.md')).toBe('/tmp/kb-root/sub/dir/note.md')
  })

  it('strips a leading slash', () => {
    expect(resolveWithinRoot(root, '/note.md')).toBe('/tmp/kb-root/note.md')
  })

  it('normalises windows-style separators', () => {
    expect(resolveWithinRoot(root, 'sub\\dir\\note.md')).toBe('/tmp/kb-root/sub/dir/note.md')
  })

  it('returns the root itself when given an empty path', () => {
    expect(resolveWithinRoot(root, '')).toBe(root)
  })

  it('rejects path traversal via ..', () => {
    expect(() => resolveWithinRoot(root, '../escape.md')).toThrow(/Path escapes root/)
  })

  it('rejects an absolute path that resolves outside the root', () => {
    expect(() => resolveWithinRoot(root, '/../etc/passwd')).toThrow(/Path escapes root/)
  })

  it('rejects deeply nested traversal that escapes', () => {
    expect(() => resolveWithinRoot(root, 'a/b/../../../escape.md')).toThrow(/Path escapes root/)
  })

  it('handles a root that already ends with a separator', () => {
    expect(resolveWithinRoot('/tmp/kb-root/', 'note.md')).toBe('/tmp/kb-root/note.md')
  })
})

describe('isNodeError', () => {
  it('returns true for a node ENOENT-style error', () => {
    const err = Object.assign(new Error('not found'), { code: 'ENOENT' })
    expect(isNodeError(err)).toBe(true)
  })

  it('returns false for a plain Error', () => {
    expect(isNodeError(new Error('plain'))).toBe(false)
  })

  it('returns false for non-Error values', () => {
    expect(isNodeError('string')).toBe(false)
    expect(isNodeError(null)).toBe(false)
    expect(isNodeError(42)).toBe(false)
  })
})

describe('errMessage', () => {
  it('returns the message for an Error', () => {
    expect(errMessage(new Error('boom'))).toBe('boom')
  })

  it('stringifies non-Error values', () => {
    expect(errMessage('boom')).toBe('boom')
    expect(errMessage(42)).toBe('42')
    expect(errMessage(null)).toBe('null')
    expect(errMessage(undefined)).toBe('undefined')
    expect(errMessage({ shape: 'plain object' })).toBe('[object Object]')
  })
})

describe('assertRealPathWithinRoot', () => {
  const tmpRoot = path.join(os.tmpdir(), 'kb-utils-tests', `run-${process.pid}`)

  beforeAll(async () => {
    await fs.mkdir(tmpRoot, { recursive: true })
    await fs.mkdir(path.join(tmpRoot, 'inner'), { recursive: true })
    await fs.writeFile(path.join(tmpRoot, 'inner', 'leaf.md'), 'x', 'utf-8')
    // Symlink pointing out of the root for the symlink-escape test
    await fs.mkdir(path.join(tmpRoot, '..', 'outside'), { recursive: true })
    await fs.writeFile(path.join(tmpRoot, '..', 'outside', 'secret.md'), 's', 'utf-8')
    try {
      await fs.symlink(path.join(tmpRoot, '..', 'outside'), path.join(tmpRoot, 'link-outside'))
    } catch {
      // already exists from a previous run
    }
  })

  afterAll(async () => {
    await fs.rm(path.join(tmpRoot, '..', 'outside'), { recursive: true, force: true })
    await fs.rm(tmpRoot, { recursive: true, force: true })
  })

  it('accepts a path inside the root', async () => {
    await expect(assertRealPathWithinRoot(tmpRoot, path.join(tmpRoot, 'inner', 'leaf.md'))).resolves.toBeUndefined()
  })

  it('walks up to find the nearest existing ancestor for a yet-to-exist path', async () => {
    const futurePath = path.join(tmpRoot, 'inner', 'does-not-exist-yet', 'sub', 'new.md')
    await expect(assertRealPathWithinRoot(tmpRoot, futurePath)).resolves.toBeUndefined()
  })

  it('rejects a symlink that escapes the root', async () => {
    const escapingPath = path.join(tmpRoot, 'link-outside', 'secret.md')
    await expect(assertRealPathWithinRoot(tmpRoot, escapingPath)).rejects.toThrow(/Path escapes root/)
  })

  it('accepts the root itself', async () => {
    await expect(assertRealPathWithinRoot(tmpRoot, tmpRoot)).resolves.toBeUndefined()
  })
})
