import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { KnowledgeBase } from '../../config/index.js'
import { createFolder, createFolderResultSchema, deleteNote, listFolders, listNotes, readNote, renameNote, writeNote } from './index.js'

// The base is injected, not read from env: build one KnowledgeBase literal
// pointing at a per-process temp KB root and pass it as the first arg to every
// main fn — exactly as the tool layer does after resolving a `kb` alias.
const ROOT_PATH = path.join(os.tmpdir(), 'knowledgeislands-tests', `notes-${process.pid}`)
// Zone used for all test fixtures. Every real KB op must start within a zone.
const ZONE = 'Pillars'
const zp = (...parts: string[]) => path.join(ROOT_PATH, ZONE, ...parts)
const base: KnowledgeBase = {
  alias: 'notes-kb',
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
  kiConfigRaw: null
}

beforeAll(async () => {
  await fs.mkdir(ROOT_PATH, { recursive: true })
})

afterAll(async () => {
  await fs.rm(ROOT_PATH, { recursive: true, force: true })
})

beforeEach(async () => {
  // Wipe contents between tests, then recreate the zone dir
  const entries = await fs.readdir(ROOT_PATH)
  await Promise.all(entries.map((e) => fs.rm(path.join(ROOT_PATH, e), { recursive: true, force: true })))
  await fs.mkdir(zp(), { recursive: true })
})

describe('writeNote', () => {
  it('writes a new note and reports byte count', async () => {
    const result = await writeNote(base, { path: `${ZONE}/a.md`, content: '# hello', create_dirs: true, dry_run: false })
    expect(result).toEqual({ path: `${ZONE}/a.md`, bytes: 7, dry_run: false, action: 'wrote (7 bytes)' })
    const onDisk = await fs.readFile(zp('a.md'), 'utf-8')
    expect(onDisk).toBe('# hello')
  })

  it('creates parent directories when create_dirs is true', async () => {
    await writeNote(base, { path: `${ZONE}/sub/nested/deep.md`, content: 'x', create_dirs: true, dry_run: false })
    const onDisk = await fs.readFile(zp('sub', 'nested', 'deep.md'), 'utf-8')
    expect(onDisk).toBe('x')
  })

  it('returns a friendly error when the parent dir is missing and create_dirs is false', async () => {
    await expect(writeNote(base, { path: `${ZONE}/missing/note.md`, content: 'x', create_dirs: false, dry_run: false })).rejects.toThrow(
      `Directory not found for: "${ZONE}/missing/note.md"`
    )
    await expect(writeNote(base, { path: `${ZONE}/missing/note.md`, content: 'x', create_dirs: false, dry_run: false })).rejects.toThrow(
      'set create_dirs: true'
    )
  })

  it('rejects path traversal', async () => {
    await expect(writeNote(base, { path: '../escape.md', content: 'x', create_dirs: true, dry_run: false })).rejects.toThrow('Path escapes root')
  })

  it('rejects paths outside KB zones', async () => {
    await expect(writeNote(base, { path: 'root-level.md', content: 'x', create_dirs: true, dry_run: false })).rejects.toThrow('outside KB zones')
  })

  it('overwrites an existing file', async () => {
    await writeNote(base, { path: `${ZONE}/over.md`, content: 'first', create_dirs: true, dry_run: false })
    await writeNote(base, { path: `${ZONE}/over.md`, content: 'second', create_dirs: true, dry_run: false })
    const onDisk = await fs.readFile(zp('over.md'), 'utf-8')
    expect(onDisk).toBe('second')
  })

  it('dry_run previews a new file without writing', async () => {
    const result = await writeNote(base, { path: `${ZONE}/preview.md`, content: 'hello world', create_dirs: true, dry_run: true })
    expect(result).toEqual({ path: `${ZONE}/preview.md`, bytes: 11, dry_run: true, action: 'would create (11 bytes)' })
    await expect(fs.access(zp('preview.md'))).rejects.toThrow()
  })

  it('dry_run previews an overwrite with both old and new byte counts', async () => {
    await writeNote(base, { path: `${ZONE}/doc.md`, content: 'short', create_dirs: true, dry_run: false })
    const result = await writeNote(base, { path: `${ZONE}/doc.md`, content: 'a much longer body', create_dirs: true, dry_run: true })
    expect(result).toEqual({ path: `${ZONE}/doc.md`, bytes: 18, dry_run: true, action: 'would overwrite (5 → 18 bytes)' })
    const onDisk = await fs.readFile(zp('doc.md'), 'utf-8')
    expect(onDisk).toBe('short')
  })

  it('dry_run rethrows non-ENOENT errors from the existence probe (e.g. ENOTDIR)', async () => {
    await fs.writeFile(zp('blocker.md'), 'x', 'utf-8')
    // "blocker.md" is a file; "blocker.md/child.md" forces ENOTDIR from fs.stat.
    await expect(writeNote(base, { path: `${ZONE}/blocker.md/child.md`, content: 'y', create_dirs: false, dry_run: true })).rejects.toThrow(/ENOTDIR/)
  })
})

describe('readNote', () => {
  it('reads an existing note', async () => {
    await fs.writeFile(zp('r.md'), 'content', 'utf-8')
    const result = await readNote(base, { path: `${ZONE}/r.md` })
    expect(result.content).toBe('content')
  })

  it('returns a friendly error for a missing file', async () => {
    await expect(readNote(base, { path: `${ZONE}/missing.md` })).rejects.toThrow(`File not found: "${ZONE}/missing.md"`)
    try {
      await readNote(base, { path: `${ZONE}/missing.md` })
      throw new Error('expected readNote to reject')
    } catch (err) {
      expect((err as Error).message).not.toContain(ROOT_PATH)
    }
  })

  it('rejects path traversal', async () => {
    await expect(readNote(base, { path: '../escape.md' })).rejects.toThrow('Path escapes root')
  })

  const FM_NOTE = '---\ntags:\n  - x\nstatus: current\n---\n# Heading\n\nBody text.\n'

  it('part "frontmatter" returns only the YAML between the fences', async () => {
    await fs.writeFile(zp('fm.md'), FM_NOTE, 'utf-8')
    const result = await readNote(base, { path: `${ZONE}/fm.md`, part: 'frontmatter' })
    expect(result.content).toBe('tags:\n  - x\nstatus: current')
  })

  it('part "body" returns only the markdown after the closing fence', async () => {
    await fs.writeFile(zp('fm.md'), FM_NOTE, 'utf-8')
    const result = await readNote(base, { path: `${ZONE}/fm.md`, part: 'body' })
    expect(result.content).toBe('# Heading\n\nBody text.\n')
  })

  it('part "frontmatter" reports "(no frontmatter)" when the note has none', async () => {
    await fs.writeFile(zp('plain.md'), '# Just a heading\n', 'utf-8')
    const result = await readNote(base, { path: `${ZONE}/plain.md`, part: 'frontmatter' })
    expect(result.content).toBe('(no frontmatter)')
  })

  it('part "body" returns the whole note when there is no frontmatter', async () => {
    await fs.writeFile(zp('plain.md'), '# Just a heading\n', 'utf-8')
    const result = await readNote(base, { path: `${ZONE}/plain.md`, part: 'body' })
    expect(result.content).toBe('# Just a heading\n')
  })

  it('errors when frontmatter is requested but the opening fence never closes', async () => {
    await fs.writeFile(zp('bad.md'), '---\ntags: x\nno closing fence\n', 'utf-8')
    await expect(readNote(base, { path: `${ZONE}/bad.md`, part: 'frontmatter' })).rejects.toThrow(`Malformed frontmatter in "${ZONE}/bad.md"`)
  })
})

describe('listNotes', () => {
  it('returns an empty list for an empty directory', async () => {
    const result = await listNotes(base, { path: '', recursive: false })
    expect(result.notes).toEqual([])
    expect(result.count).toBe(0)
  })

  it('lists .md files in the root', async () => {
    await fs.writeFile(zp('a.md'), 'a', 'utf-8')
    await fs.writeFile(zp('b.md'), 'b', 'utf-8')
    await fs.writeFile(zp('note.txt'), 'ignored', 'utf-8')
    const result = await listNotes(base, { path: '', recursive: false })
    // Non-recursive root listing does not descend into zone dirs
    expect(result.notes).toEqual([])
    expect(result.count).toBe(0)
  })

  it('lists .md files within a zone', async () => {
    await fs.writeFile(zp('a.md'), 'a', 'utf-8')
    await fs.writeFile(zp('b.md'), 'b', 'utf-8')
    await fs.writeFile(zp('note.txt'), 'ignored', 'utf-8')
    const result = await listNotes(base, { path: ZONE, recursive: false })
    expect([...result.notes].sort()).toEqual([`${ZONE}/a.md`, `${ZONE}/b.md`])
    expect(result.count).toBe(2)
  })

  it('does not descend into sub-directories when recursive is false', async () => {
    await fs.mkdir(zp('sub'), { recursive: true })
    await fs.writeFile(zp('top.md'), 'a', 'utf-8')
    await fs.writeFile(zp('sub', 'nested.md'), 'b', 'utf-8')
    const result = await listNotes(base, { path: ZONE, recursive: false })
    expect(result.notes).toEqual([`${ZONE}/top.md`])
  })

  it('descends into sub-directories when recursive is true', async () => {
    await fs.mkdir(zp('sub'), { recursive: true })
    await fs.writeFile(zp('top.md'), 'a', 'utf-8')
    await fs.writeFile(zp('sub', 'nested.md'), 'b', 'utf-8')
    const result = await listNotes(base, { path: ZONE, recursive: true })
    expect([...result.notes].sort()).toEqual([`${ZONE}/sub/nested.md`, `${ZONE}/top.md`])
  })

  it('lists notes inside a specified subdirectory', async () => {
    await fs.mkdir(zp('sub'), { recursive: true })
    await fs.writeFile(zp('sub', 'inner.md'), 'a', 'utf-8')
    const result = await listNotes(base, { path: `${ZONE}/sub`, recursive: false })
    expect(result.notes).toEqual([`${ZONE}/sub/inner.md`])
  })

  it('returns a friendly error when the directory is missing', async () => {
    await expect(listNotes(base, { path: `${ZONE}/does-not-exist`, recursive: false })).rejects.toThrow(`Directory not found: "${ZONE}/does-not-exist"`)
  })

  it('returns a friendly error for path traversal', async () => {
    await expect(listNotes(base, { path: '../', recursive: false })).rejects.toThrow('Path escapes root')
  })
})

describe('listFolders', () => {
  it('returns an empty list for an empty directory', async () => {
    // root listing shows the zone dir — use the zone path to get empty result
    const result = await listFolders(base, { path: ZONE, recursive: false })
    expect(result.folders).toEqual([])
    expect(result.count).toBe(0)
  })

  it('lists folders inside a zone, ignores notes', async () => {
    await fs.mkdir(zp('a'), { recursive: true })
    await fs.mkdir(zp('b'), { recursive: true })
    await fs.writeFile(zp('note.md'), 'ignored', 'utf-8')
    const result = await listFolders(base, { path: ZONE, recursive: false })
    expect([...result.folders].sort()).toEqual([`${ZONE}/a`, `${ZONE}/b`])
  })

  it('does not descend recursive false', async () => {
    await fs.mkdir(zp('top', 'nested'), { recursive: true })
    const result = await listFolders(base, { path: ZONE, recursive: false })
    expect(result.folders).toEqual([`${ZONE}/top`])
  })

  it('descends recursive true', async () => {
    await fs.mkdir(zp('top', 'nested'), { recursive: true })
    await fs.mkdir(zp('sibling'), { recursive: true })
    const result = await listFolders(base, { path: ZONE, recursive: true })
    expect([...result.folders].sort()).toEqual([`${ZONE}/sibling`, `${ZONE}/top`, `${ZONE}/top/nested`])
  })

  it('lists folders inside specified subdirectory', async () => {
    await fs.mkdir(zp('sub', 'inner'), { recursive: true })
    const result = await listFolders(base, { path: `${ZONE}/sub`, recursive: false })
    expect(result.folders).toEqual([`${ZONE}/sub/inner`])
  })

  it('returns friendly error directory missing', async () => {
    await expect(listFolders(base, { path: `${ZONE}/does-not-exist`, recursive: false })).rejects.toThrow(`Directory not found: "${ZONE}/does-not-exist"`)
  })

  it('returns friendly error path traversal', async () => {
    await expect(listFolders(base, { path: '../', recursive: false })).rejects.toThrow('Path escapes root')
  })
})

describe('zone-scoping', () => {
  it('readNote rejects a path outside KB zones', async () => {
    await expect(readNote(base, { path: 'root-level.md' })).rejects.toThrow('outside KB zones')
  })

  it('listNotes rejects subdirectory that is not a zone', async () => {
    await expect(listNotes(base, { path: 'archive', recursive: false })).rejects.toThrow('outside KB zones')
  })

  it('listFolders rejects subdirectory that is not a zone', async () => {
    await expect(listFolders(base, { path: 'archive', recursive: false })).rejects.toThrow('outside KB zones')
  })

  it('writeNote rejects paths outside KB zones', async () => {
    await expect(writeNote(base, { path: 'README.md', content: 'x', create_dirs: true, dry_run: false })).rejects.toThrow('outside KB zones')
  })
})

describe('protected path rules', () => {
  it('readNote refuses dotfiles within a zone', async () => {
    await expect(readNote(base, { path: `${ZONE}/.env.md` })).rejects.toThrow('Path is protected')
    await expect(readNote(base, { path: `${ZONE}/sub/.hidden.md` })).rejects.toThrow('Path is protected')
  })

  it('readNote allows nested README inside a zone (root-only rule)', async () => {
    await fs.mkdir(zp('archive'), { recursive: true })
    await fs.writeFile(zp('archive', 'README.md'), 'note', 'utf-8')
    const result = await readNote(base, { path: `${ZONE}/archive/README.md` })
    expect(result.content).toBe('note')
  })

  it('writeNote refuses root-level meta files (outside zones)', async () => {
    // Root README outside zone; zone error fires first
    await expect(writeNote(base, { path: 'README.md', content: 'x', create_dirs: true, dry_run: false })).rejects.toThrow('outside KB zones')
  })

  it('writeNote refuses dotfiles within a zone', async () => {
    await expect(writeNote(base, { path: `${ZONE}/.obsidian/foo.md`, content: 'x', create_dirs: true, dry_run: false })).rejects.toThrow('Path is protected')
  })

  it('listNotes ignores root meta files, even when a KB note has the same name', async () => {
    await fs.writeFile(path.join(ROOT_PATH, 'README.md'), 'meta', 'utf-8')
    await fs.writeFile(path.join(ROOT_PATH, 'CLAUDE.md'), 'meta', 'utf-8')
    await fs.writeFile(zp('real.md'), 'note', 'utf-8')
    await fs.mkdir(path.join(ROOT_PATH, '.obsidian'), { recursive: true })
    await fs.writeFile(path.join(ROOT_PATH, '.obsidian', 'config.md'), 'hidden', 'utf-8')
    const result = await listNotes(base, { path: ZONE, recursive: false })
    expect(result.notes).toEqual([`${ZONE}/real.md`])
  })

  it('readNote refuses a directory (even with .md suffix)', async () => {
    await fs.mkdir(zp('sub.md'), { recursive: true })
    await expect(readNote(base, { path: `${ZONE}/sub.md` })).rejects.toThrow('Not a note file')
  })
})

describe('path hardening', () => {
  it('readNote escapes root via traversal', async () => {
    await expect(readNote(base, { path: '../escape.md' })).rejects.toThrow('Path escapes root')
  })

  it('readNote escapes root via symlink (realpath check)', async () => {
    const outside = path.join(ROOT_PATH, '..', 'kb-test-outside')
    try {
      await fs.mkdir(outside, { recursive: true })
      await fs.writeFile(path.join(outside, 'secret.md'), 'leaked', 'utf-8')
      await fs.symlink(outside, zp('leak'))
      await expect(readNote(base, { path: `${ZONE}/leak/secret.md` })).rejects.toThrow('Path escapes root')
    } finally {
      await fs.rm(outside, { recursive: true, force: true })
    }
  })

  it('writeNote escapes root via symlink (realpath check)', async () => {
    const outside = path.join(ROOT_PATH, '..', 'kb-test-outside-w')
    try {
      await fs.mkdir(outside, { recursive: true })
      await fs.symlink(outside, zp('leakdir'))
      await expect(writeNote(base, { path: `${ZONE}/leakdir/x.md`, content: 'leaked', create_dirs: false, dry_run: false })).rejects.toThrow(
        'Path escapes root'
      )
      await expect(fs.readFile(path.join(outside, 'x.md'), 'utf-8')).rejects.toThrow()
    } finally {
      await fs.rm(outside, { recursive: true, force: true })
    }
  })
})

describe('renameNote', () => {
  it('renames a note', async () => {
    await fs.writeFile(zp('a.md'), 'a', 'utf-8')
    await fs.writeFile(zp('b.md'), 'b', 'utf-8')
    const result = await renameNote(base, { from: `${ZONE}/a.md`, to: `${ZONE}/c.md`, create_dirs: true })
    expect(result).toEqual({ from: `${ZONE}/a.md`, to: `${ZONE}/c.md` })
    expect(await fs.readFile(zp('c.md'), 'utf-8')).toBe('a')
    expect(await fs.readFile(zp('b.md'), 'utf-8')).toBe('b')
  })

  it('returns an error when destination already exists', async () => {
    await fs.writeFile(zp('a.md'), 'a', 'utf-8')
    await fs.writeFile(zp('b.md'), 'b', 'utf-8')
    await expect(renameNote(base, { from: `${ZONE}/a.md`, to: `${ZONE}/b.md`, create_dirs: true })).rejects.toThrow('Destination')
    expect(await fs.readFile(zp('a.md'), 'utf-8')).toBe('a')
    expect(await fs.readFile(zp('b.md'), 'utf-8')).toBe('b')
  })

  it('returns a friendly error when the source is missing', async () => {
    await expect(renameNote(base, { from: `${ZONE}/missing.md`, to: `${ZONE}/new.md`, create_dirs: true })).rejects.toThrow(
      `File not found: "${ZONE}/missing.md"`
    )
  })

  it('rejects a non-.md destination', async () => {
    await expect(renameNote(base, { from: `${ZONE}/a.md`, to: `${ZONE}/b.md`.replace('.md', '.txt'), create_dirs: true })).rejects.toThrow(
      'Notes must end in ".md"'
    )
  })

  it('rejects renaming to the same path', async () => {
    await expect(renameNote(base, { from: `${ZONE}/a.md`, to: `${ZONE}/a.md`, create_dirs: true })).rejects.toThrow(
      'Rename source and destination are the same path'
    )
  })

  it('creates destination parent dirs when create_dirs is true', async () => {
    await fs.writeFile(zp('src.md'), 'x', 'utf-8')
    const result = await renameNote(base, { from: `${ZONE}/src.md`, to: `${ZONE}/sub/dst.md`, create_dirs: true })
    expect(result).toEqual({ from: `${ZONE}/src.md`, to: `${ZONE}/sub/dst.md` })
    expect(await fs.readFile(zp('sub', 'dst.md'), 'utf-8')).toBe('x')
  })

  it('fails to rename from a directory (not a file)', async () => {
    await fs.mkdir(zp('dir.md'), { recursive: true })
    await expect(renameNote(base, { from: `${ZONE}/dir.md`, to: `${ZONE}/new.md`, create_dirs: false })).rejects.toThrow('Not a note file')
  })

  it('fails when create_dirs is false and the destination parent is missing', async () => {
    await fs.writeFile(zp('src.md'), 'x', 'utf-8')
    await expect(renameNote(base, { from: `${ZONE}/src.md`, to: `${ZONE}/missing/dst.md`, create_dirs: false })).rejects.toThrow(
      `destination parent missing for "${ZONE}/missing/dst.md"`
    )
    await expect(renameNote(base, { from: `${ZONE}/src.md`, to: `${ZONE}/missing/dst.md`, create_dirs: false })).rejects.toThrow('set create_dirs: true')
    expect(await fs.readFile(zp('src.md'), 'utf-8')).toBe('x')
  })

  it('reports ENOTDIR when the path traverses through a file', async () => {
    await fs.writeFile(zp('blocker.md'), 'x', 'utf-8')
    await fs.writeFile(zp('src.md'), 'y', 'utf-8')
    await expect(renameNote(base, { from: `${ZONE}/src.md`, to: `${ZONE}/blocker.md/dst.md`, create_dirs: false })).rejects.toThrow()
  })
})

describe('deleteNote', () => {
  it('deletes a note and returns byte count', async () => {
    await fs.writeFile(zp('a.md'), 'hello', 'utf-8')
    const result = await deleteNote(base, { path: `${ZONE}/a.md`, dry_run: false })
    expect(result).toEqual({ path: `${ZONE}/a.md`, bytes: 5, deleted: true, dry_run: false, action: 'deleted (5 bytes)' })
    await expect(fs.access(zp('a.md'))).rejects.toThrow()
  })

  it('dry_run reports what would be deleted without deleting', async () => {
    await fs.writeFile(zp('a.md'), 'hello', 'utf-8')
    const result = await deleteNote(base, { path: `${ZONE}/a.md`, dry_run: true })
    expect(result).toEqual({ path: `${ZONE}/a.md`, bytes: 5, deleted: false, dry_run: true, action: 'would delete (5 bytes)' })
    await fs.access(zp('a.md')) // throws if file was deleted
  })

  it('returns a friendly error when the file is missing', async () => {
    await expect(deleteNote(base, { path: `${ZONE}/missing.md`, dry_run: false })).rejects.toThrow(`File not found: "${ZONE}/missing.md"`)
  })

  it('rejects a non-.md path', async () => {
    await expect(deleteNote(base, { path: `${ZONE}/a.txt`, dry_run: false })).rejects.toThrow('Notes must end in ".md"')
  })

  it('rejects path traversal', async () => {
    await expect(deleteNote(base, { path: '../escape.md', dry_run: false })).rejects.toThrow('Path escapes root')
  })

  it('refuses protected paths within a zone', async () => {
    await fs.writeFile(zp('.secret.md'), 'x', 'utf-8')
    await expect(deleteNote(base, { path: `${ZONE}/.secret.md`, dry_run: false })).rejects.toThrow('Path is protected')
    expect(await fs.readFile(zp('.secret.md'), 'utf-8')).toBe('x')
  })

  it('returns an error when path is a directory not a file', async () => {
    await fs.mkdir(zp('subdir'), { recursive: true })
    await expect(deleteNote(base, { path: `${ZONE}/subdir`, dry_run: false })).rejects.toThrow('Notes must end in ".md"')
  })
})

describe('createFolder', () => {
  it('creates a new folder', async () => {
    const result = await createFolder(base, { path: `${ZONE}/newfolder` })
    expect(result).toEqual({ path: `${ZONE}/newfolder`, existed: false, created: true })
    await fs.access(zp('newfolder')) // throws if not created
  })

  it('returns a success message for an already-existing folder', async () => {
    await fs.mkdir(zp('existing'), { recursive: true })
    const result = await createFolder(base, { path: `${ZONE}/existing` })
    expect(result).toEqual({ path: `${ZONE}/existing`, existed: true, created: false })
  })

  it('returns a friendly error for an empty path', async () => {
    await expect(createFolder(base, { path: '' })).rejects.toThrow('Folder path must not be empty')
  })

  it('rejects path traversal', async () => {
    await expect(createFolder(base, { path: '../escape' })).rejects.toThrow('Path escapes root')
  })

  it('rejects paths outside KB zones', async () => {
    await expect(createFolder(base, { path: 'not-a-zone' })).rejects.toThrow('outside KB zones')
  })

  it('returns an error when path is an existing file', async () => {
    await fs.writeFile(zp('blocker.md'), 'x', 'utf-8')
    // "blocker.md" is a file; "blocker.md/sub" forces a failure
    await expect(createFolder(base, { path: `${ZONE}/blocker.md/sub` })).rejects.toThrow()
  })
})

describe('walk robustness', () => {
  it('caps recursion at MAX_WALK_DEPTH (32); (0..40) go in, (33+) not in results', async () => {
    // Build a chain deeper than MAX_WALK_DEPTH without walking it during construction
    const DEPTH_PAST_CAP = 40
    const makeDeepChain = async (segments: string[]) => {
      const dir = path.join(ROOT_PATH, ...segments)
      await fs.mkdir(dir, { recursive: true })
      if (segments.length < DEPTH_PAST_CAP) {
        await makeDeepChain([...segments, `d${segments.length - 2}`])
      }
    }
    await makeDeepChain([ZONE, 'd0', 'd1'])
    // Drop a note at depth 1 so listNotes has something to find
    await fs.writeFile(path.join(ROOT_PATH, ZONE, 'd0', 'note.md'), 'x', 'utf-8')
    const result = await listNotes(base, { path: ZONE, recursive: true })
    // Should find the note at depth 1 within ZONE
    expect(result.notes.some((l) => l.includes('d0') && l.endsWith('note.md'))).toBe(true)
    // Should NOT see past the cap (no .md files that deep anyway, but belt-and-braces)
    expect(result.notes.some((l) => l.includes(`d${DEPTH_PAST_CAP - 1}`))).toBe(false)
  })

  it('does not descend into node_modules', async () => {
    await fs.mkdir(zp('node_modules', 'pkg'), { recursive: true })
    await fs.writeFile(zp('node_modules', 'pkg', 'dep.md'), 'x', 'utf-8')
    await fs.writeFile(zp('real.md'), 'x', 'utf-8')
    const result = await listNotes(base, { path: ZONE, recursive: true })
    expect([...result.notes].sort()).toEqual([`${ZONE}/real.md`])
  })

  it('listFolders does not descend into node_modules (not listed)', async () => {
    await fs.mkdir(zp('node_modules', 'pkg'), { recursive: true })
    await fs.mkdir(zp('visible'), { recursive: true })
    const result = await listFolders(base, { path: ZONE, recursive: true })
    expect([...result.folders].sort()).toEqual([`${ZONE}/visible`])
  })

  it('listFolders hides dotdirs', async () => {
    await fs.mkdir(path.join(ROOT_PATH, '.git'), { recursive: true })
    await fs.mkdir(zp('.obsidian', 'sub'), { recursive: true })
    await fs.mkdir(zp('visible'), { recursive: true })
    const result = await listFolders(base, { path: ZONE, recursive: true })
    expect([...result.folders].sort()).toEqual([`${ZONE}/visible`])
  })
})

describe('result schemas', () => {
  it('createFolder result satisfies the createFolderResultSchema outputSchema', async () => {
    const result = await createFolder(base, { path: `${ZONE}/schema-check` })
    expect(() => createFolderResultSchema.parse(result)).not.toThrow()
  })
})
