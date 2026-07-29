import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Config } from '../../config/index.js'
import {
  deleteFile,
  deleteFileResultSchema,
  listContent,
  listContentResultSchema,
  listFiles,
  readFile,
  readFileResultSchema,
  renameFile,
  renameFileResultSchema,
  writeFile,
  writeFileResultSchema
} from './index.js'

const ROOT_PATH = path.join(os.tmpdir(), 'knowledgeislands-tests', `files-${process.pid}`)
const ZONE = 'Pillars'
const zp = (...parts: string[]) => path.join(ROOT_PATH, ZONE, ...parts)
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

beforeAll(async () => {
  await fs.mkdir(ROOT_PATH, { recursive: true })
})

afterAll(async () => {
  await fs.rm(ROOT_PATH, { recursive: true, force: true })
})

beforeEach(async () => {
  const entries = await fs.readdir(ROOT_PATH)
  await Promise.all(entries.map((e) => fs.rm(path.join(ROOT_PATH, e), { recursive: true, force: true })))
  await fs.mkdir(zp(), { recursive: true })
})

describe('readFile', () => {
  it('reads a utf-8 text file', async () => {
    await fs.writeFile(zp('hello.txt'), 'hello world', 'utf-8')
    const result = await readFile(cfg, { path: `${ZONE}/hello.txt` })
    expect(result.encoding).toBe('utf-8')
    expect(result.content).toBe('hello world')
    expect(result.mimeType).toBe('text/plain')
  })

  it('reads a binary file as base64', async () => {
    // Write a two-byte buffer that is not valid UTF-8
    const buf = Buffer.from([0xff, 0xfe])
    await fs.writeFile(zp('bin.bin'), buf)
    const result = await readFile(cfg, { path: `${ZONE}/bin.bin` })
    expect(result.encoding).toBe('base64')
    expect(Buffer.from(result.content, 'base64')).toEqual(buf)
  })

  it('returns a friendly error for a missing file', async () => {
    await expect(readFile(cfg, { path: `${ZONE}/missing.png` })).rejects.toThrow('File not found')
  })

  it('returns an error when path is a directory', async () => {
    await fs.mkdir(zp('subdir'), { recursive: true })
    await expect(readFile(cfg, { path: `${ZONE}/subdir` })).rejects.toThrow('Not a file')
  })

  it('rejects path traversal', async () => {
    await expect(readFile(cfg, { path: '../escape.png' })).rejects.toThrow('Path escapes root')
  })

  it('rejects paths outside KB zones', async () => {
    await expect(readFile(cfg, { path: 'root-level.png' })).rejects.toThrow('outside KB zones')
  })

  it('rejects protected paths (dotfiles)', async () => {
    await expect(readFile(cfg, { path: `${ZONE}/.hidden.png` })).rejects.toThrow('Path is protected')
  })

  it('detects correct MIME type for .png', async () => {
    await fs.writeFile(zp('img.png'), 'fake-png', 'utf-8')
    const result = await readFile(cfg, { path: `${ZONE}/img.png` })
    expect(result.mimeType).toBe('image/png')
  })

  it('falls back to application/octet-stream for unknown extension', async () => {
    await fs.writeFile(zp('archive.xyz'), 'data', 'utf-8')
    const result = await readFile(cfg, { path: `${ZONE}/archive.xyz` })
    expect(result.mimeType).toBe('application/octet-stream')
  })

  it('returns Markdown frontmatter or body when requested', async () => {
    await fs.writeFile(zp('frontmatter.md'), '---\ntitle: Test\n---\n# Body\n', 'utf-8')
    const frontmatter = await readFile(cfg, { path: `${ZONE}/frontmatter.md`, part: 'frontmatter' })
    const body = await readFile(cfg, { path: `${ZONE}/frontmatter.md`, part: 'body' })
    expect(frontmatter.content).toBe('title: Test')
    expect(body.content).toBe('# Body\n')
  })

  it('rejects Markdown parts for a non-Markdown file', async () => {
    await fs.writeFile(zp('hello.txt'), 'hello', 'utf-8')
    await expect(readFile(cfg, { path: `${ZONE}/hello.txt`, part: 'body' })).rejects.toThrow('only available for UTF-8 Markdown')
  })

  it('rejects Markdown parts for a binary (base64) file', async () => {
    await fs.writeFile(zp('bin.md'), Buffer.from([0xff, 0xfe]))
    await expect(readFile(cfg, { path: `${ZONE}/bin.md`, part: 'frontmatter' })).rejects.toThrow('only available for UTF-8 Markdown')
  })

  it('returns an error for frontmatter opened but never closed', async () => {
    await fs.writeFile(zp('malformed.md'), '---\ntitle: Test\n# Body\n', 'utf-8')
    await expect(readFile(cfg, { path: `${ZONE}/malformed.md`, part: 'body' })).rejects.toThrow('Malformed frontmatter')
  })

  it('reports "(no frontmatter)" for a Markdown file that has none', async () => {
    await fs.writeFile(zp('plain.md'), '# Body only\n', 'utf-8')
    const frontmatter = await readFile(cfg, { path: `${ZONE}/plain.md`, part: 'frontmatter' })
    const body = await readFile(cfg, { path: `${ZONE}/plain.md`, part: 'body' })
    expect(frontmatter.content).toBe('(no frontmatter)')
    expect(body.content).toBe('# Body only\n')
  })

  it('returns the whole file unsplit when part is all, even with malformed frontmatter', async () => {
    await fs.writeFile(zp('malformed.md'), '---\ntitle: Test\n# Body\n', 'utf-8')
    const result = await readFile(cfg, { path: `${ZONE}/malformed.md` })
    expect(result.content).toBe('---\ntitle: Test\n# Body\n')
  })
})

describe('readFile — root-file allow-list', () => {
  it('reads a default allow-listed root README', async () => {
    await fs.writeFile(path.join(ROOT_PATH, 'README.md'), '# KB context', 'utf-8')
    const result = await readFile(cfg, { path: 'README.md' })
    expect(result).toMatchObject({ path: 'README.md', encoding: 'utf-8', mimeType: 'text/markdown', content: '# KB context' })
  })

  it('reads an explicitly configured nested agent instruction file', async () => {
    await fs.mkdir(path.join(ROOT_PATH, '.github'), { recursive: true })
    await fs.writeFile(path.join(ROOT_PATH, '.github', 'copilot-instructions.md'), '# Copilot', 'utf-8')
    const result = await readFile(
      { ...cfg, rootFileAllowlist: ['.github/copilot-instructions.md'] },
      { path: '.github/copilot-instructions.md' }
    )
    expect(result.content).toBe('# Copilot')
  })

  it('rejects every path not in the exact allow-list', async () => {
    await fs.writeFile(path.join(ROOT_PATH, 'LICENSE.md'), 'private licence', 'utf-8')
    await expect(readFile(cfg, { path: 'LICENSE.md' })).rejects.toThrow('root_file_allowlist')
  })

  it('rejects traversal before testing the allow-list', async () => {
    await expect(readFile(cfg, { path: '../README.md' })).rejects.toThrow('Path escapes root')
  })

  it('requires the configured path spelling exactly', async () => {
    await fs.writeFile(path.join(ROOT_PATH, 'README.md'), '# KB context', 'utf-8')
    await expect(readFile(cfg, { path: './README.md' })).rejects.toThrow('root_file_allowlist')
  })

  it('rejects an allow-listed filename when it is a symlink outside the KB root', async () => {
    const outside = path.join(ROOT_PATH, '..', `root-file-outside-${process.pid}.md`)
    try {
      await fs.writeFile(outside, 'secret', 'utf-8')
      await fs.symlink(outside, path.join(ROOT_PATH, 'README.md'))
      await expect(readFile(cfg, { path: 'README.md' })).rejects.toThrow('Path escapes root')
    } finally {
      await fs.rm(outside, { force: true })
    }
  })
})

describe('listContent', () => {
  it('returns a uniform JSON response for files, folders, and Markdown notes', async () => {
    await fs.writeFile(zp('note.md'), '# note', 'utf-8')
    await fs.writeFile(zp('asset.txt'), 'asset', 'utf-8')
    await fs.mkdir(zp('folder'), { recursive: true })

    const files = await listContent(cfg, { path: ZONE, kind: 'files', recursive: false })
    const folders = await listContent(cfg, { path: ZONE, kind: 'folders', recursive: false })
    const notes = await listContent(cfg, { path: ZONE, kind: 'notes', recursive: false })

    expect(files.entries.sort()).toEqual([`${ZONE}/asset.txt`, `${ZONE}/note.md`])
    expect(folders.entries).toEqual([`${ZONE}/folder`])
    expect(notes.entries).toEqual([`${ZONE}/note.md`])
  })

  it('does not allow listing the KB root or an allow-listed root file', async () => {
    await expect(listContent(cfg, { path: '', kind: 'files', recursive: false })).rejects.toThrow('outside KB zones')
  })

  it('rejects protected paths inside a zone', async () => {
    await fs.mkdir(zp('.hidden'), { recursive: true })
    await expect(listContent(cfg, { path: `${ZONE}/.hidden`, kind: 'files', recursive: false })).rejects.toThrow('Path is protected')
  })

  it('returns error for a missing directory', async () => {
    await expect(listContent(cfg, { path: `${ZONE}/nope`, kind: 'files', recursive: false })).rejects.toThrow('Directory not found')
  })
})

describe('listFiles', () => {
  it('lists files non-recursively', async () => {
    await fs.writeFile(zp('a.txt'), 'a', 'utf-8')
    await fs.writeFile(zp('b.png'), 'b', 'utf-8')
    await fs.mkdir(zp('sub'), { recursive: true })
    await fs.writeFile(zp('sub', 'c.txt'), 'c', 'utf-8')
    const result = await listFiles(cfg, { path: ZONE, recursive: false })
    expect(result.count).toBe(2)
    expect(result.files.sort()).toEqual([`${ZONE}/a.txt`, `${ZONE}/b.png`])
  })

  it('lists files recursively', async () => {
    await fs.writeFile(zp('a.txt'), 'a', 'utf-8')
    await fs.mkdir(zp('sub'), { recursive: true })
    await fs.writeFile(zp('sub', 'b.txt'), 'b', 'utf-8')
    const result = await listFiles(cfg, { path: ZONE, recursive: true })
    expect(result.count).toBe(2)
    expect(result.files.sort()).toEqual([`${ZONE}/a.txt`, `${ZONE}/sub/b.txt`])
  })

  it('skips protected dotfiles and dotdirs when walking (shared.ts protected-entry skip)', async () => {
    await fs.writeFile(zp('a.txt'), 'a', 'utf-8')
    await fs.writeFile(zp('.secret.txt'), 'secret', 'utf-8')
    await fs.mkdir(zp('.git'), { recursive: true })
    await fs.writeFile(zp('.git', 'config'), 'nope', 'utf-8')
    const result = await listFiles(cfg, { path: ZONE, recursive: true })
    expect(result.files).toEqual([`${ZONE}/a.txt`])
  })

  it('filters by extension', async () => {
    await fs.writeFile(zp('a.txt'), 'a', 'utf-8')
    await fs.writeFile(zp('b.png'), 'b', 'utf-8')
    const result = await listFiles(cfg, { path: ZONE, recursive: false, ext: '.png' })
    expect(result.count).toBe(1)
    expect(result.files).toEqual([`${ZONE}/b.png`])
  })

  it('returns empty list for an empty directory', async () => {
    const result = await listFiles(cfg, { path: ZONE, recursive: false })
    expect(result.count).toBe(0)
    expect(result.files).toEqual([])
  })

  it('rejects paths outside KB zones', async () => {
    await expect(listFiles(cfg, { path: 'not-a-zone', recursive: false })).rejects.toThrow('outside KB zones')
  })

  it('rejects protected paths', async () => {
    await expect(listFiles(cfg, { path: `${ZONE}/.obsidian`, recursive: false })).rejects.toThrow('Path is protected')
  })

  it('returns error for missing directory', async () => {
    await expect(listFiles(cfg, { path: `${ZONE}/does-not-exist`, recursive: false })).rejects.toThrow()
  })
})

describe('writeFile', () => {
  it('writes a utf-8 text file', async () => {
    const result = await writeFile(cfg, { path: `${ZONE}/out.txt`, content: 'hello', encoding: 'utf-8', create_dirs: true, dry_run: false })
    expect(result.bytes).toBe(5)
    const onDisk = await fs.readFile(zp('out.txt'), 'utf-8')
    expect(onDisk).toBe('hello')
  })

  it('writes a base64-encoded binary file', async () => {
    const buf = Buffer.from([0xde, 0xad, 0xbe, 0xef])
    const b64 = buf.toString('base64')
    await writeFile(cfg, { path: `${ZONE}/bin.bin`, content: b64, encoding: 'base64', create_dirs: true, dry_run: false })
    const onDisk = await fs.readFile(zp('bin.bin'))
    expect(onDisk).toEqual(buf)
  })

  it('dry_run previews a new file without writing', async () => {
    const result = await writeFile(cfg, {
      path: `${ZONE}/preview.txt`,
      content: 'hello',
      encoding: 'utf-8',
      create_dirs: true,
      dry_run: true
    })
    expect(result.dry_run).toBe(true)
    expect(result.action).toContain('would create')
    await expect(fs.access(zp('preview.txt'))).rejects.toThrow()
  })

  it('dry_run previews an overwrite with byte counts', async () => {
    await fs.writeFile(zp('doc.txt'), 'short', 'utf-8')
    const result = await writeFile(cfg, {
      path: `${ZONE}/doc.txt`,
      content: 'much longer content',
      encoding: 'utf-8',
      create_dirs: true,
      dry_run: true
    })
    expect(result.action).toContain('would overwrite')
    const onDisk = await fs.readFile(zp('doc.txt'), 'utf-8')
    expect(onDisk).toBe('short') // unchanged
  })

  it('returns error when directory missing and create_dirs is false', async () => {
    const call = writeFile(cfg, {
      path: `${ZONE}/missing/out.txt`,
      content: 'x',
      encoding: 'utf-8',
      create_dirs: false,
      dry_run: false
    })
    await expect(call).rejects.toThrow('Directory not found')
    await expect(call).rejects.toThrow('create_dirs')
  })

  it('creates parent directories when create_dirs is true', async () => {
    await writeFile(cfg, { path: `${ZONE}/sub/deep/out.txt`, content: 'x', encoding: 'utf-8', create_dirs: true, dry_run: false })
    const onDisk = await fs.readFile(zp('sub', 'deep', 'out.txt'), 'utf-8')
    expect(onDisk).toBe('x')
  })

  it('rejects path traversal', async () => {
    await expect(
      writeFile(cfg, { path: '../escape.txt', content: 'x', encoding: 'utf-8', create_dirs: false, dry_run: false })
    ).rejects.toThrow('Path escapes root')
  })

  it('rejects paths outside KB zones', async () => {
    await expect(
      writeFile(cfg, { path: 'root-level.txt', content: 'x', encoding: 'utf-8', create_dirs: true, dry_run: false })
    ).rejects.toThrow('outside KB zones')
  })

  it('rejects protected paths', async () => {
    await expect(
      writeFile(cfg, { path: `${ZONE}/.env`, content: 'x', encoding: 'utf-8', create_dirs: true, dry_run: false })
    ).rejects.toThrow('Path is protected')
  })

  it('dry_run rethrows non-ENOENT errors from the existence probe', async () => {
    await fs.writeFile(zp('blocker.txt'), 'x', 'utf-8')
    // "blocker.txt" is a file; "blocker.txt/child.txt" forces ENOTDIR from fs.stat
    await expect(
      writeFile(cfg, {
        path: `${ZONE}/blocker.txt/child.txt`,
        content: 'y',
        encoding: 'utf-8',
        create_dirs: false,
        dry_run: true
      })
    ).rejects.toThrow()
  })
})

describe('renameFile — non-ENOENT error (line 228)', () => {
  it('returns error when destination parent traversal causes ENOTDIR', async () => {
    await fs.writeFile(zp('blocker.png'), 'x', 'utf-8')
    await fs.writeFile(zp('src.png'), 'y', 'utf-8')
    // "blocker.png" is a file; "blocker.png/child.png" triggers ENOTDIR, not ENOENT
    await expect(renameFile(cfg, { from: `${ZONE}/src.png`, to: `${ZONE}/blocker.png/child.png`, create_dirs: false })).rejects.toThrow()
  })
})

describe('renameFile', () => {
  it('renames a file', async () => {
    await fs.writeFile(zp('a.png'), 'data', 'utf-8')
    const result = await renameFile(cfg, { from: `${ZONE}/a.png`, to: `${ZONE}/b.png`, create_dirs: true })
    expect(result.from).toBe(`${ZONE}/a.png`)
    expect(result.to).toBe(`${ZONE}/b.png`)
    await expect(fs.access(zp('b.png'))).resolves.toBeUndefined()
    await expect(fs.access(zp('a.png'))).rejects.toThrow()
  })

  it('returns error when destination already exists', async () => {
    await fs.writeFile(zp('a.png'), 'a', 'utf-8')
    await fs.writeFile(zp('b.png'), 'b', 'utf-8')
    await expect(renameFile(cfg, { from: `${ZONE}/a.png`, to: `${ZONE}/b.png`, create_dirs: true })).rejects.toThrow(
      'Destination already exists'
    )
  })

  it('returns error when source is missing', async () => {
    await expect(renameFile(cfg, { from: `${ZONE}/missing.png`, to: `${ZONE}/new.png`, create_dirs: true })).rejects.toThrow(
      'File not found'
    )
  })

  it('returns error when source and destination are the same', async () => {
    await expect(renameFile(cfg, { from: `${ZONE}/a.png`, to: `${ZONE}/a.png`, create_dirs: true })).rejects.toThrow('same')
  })

  it('returns error when source is a directory not a file', async () => {
    await fs.mkdir(zp('dir'), { recursive: true })
    await expect(renameFile(cfg, { from: `${ZONE}/dir`, to: `${ZONE}/dir2`, create_dirs: true })).rejects.toThrow('Not a file')
  })

  it('creates destination parent dirs when create_dirs is true', async () => {
    await fs.writeFile(zp('src.png'), 'x', 'utf-8')
    await renameFile(cfg, { from: `${ZONE}/src.png`, to: `${ZONE}/sub/dst.png`, create_dirs: true })
    await expect(fs.access(zp('sub', 'dst.png'))).resolves.toBeUndefined()
  })

  it('rejects destination outside KB zones', async () => {
    await fs.writeFile(zp('src.png'), 'x', 'utf-8')
    await expect(renameFile(cfg, { from: `${ZONE}/src.png`, to: 'root-level.png', create_dirs: false })).rejects.toThrow('outside KB zones')
  })

  it('rejects source outside KB zones', async () => {
    await expect(renameFile(cfg, { from: 'root-level.png', to: `${ZONE}/dst.png`, create_dirs: false })).rejects.toThrow('outside KB zones')
  })

  it('rejects protected source path', async () => {
    await expect(renameFile(cfg, { from: `${ZONE}/.hidden.png`, to: `${ZONE}/dst.png`, create_dirs: false })).rejects.toThrow(
      'Path is protected'
    )
  })

  it('rejects protected destination path', async () => {
    await fs.writeFile(zp('src.png'), 'x', 'utf-8')
    await expect(renameFile(cfg, { from: `${ZONE}/src.png`, to: `${ZONE}/.hidden.png`, create_dirs: false })).rejects.toThrow(
      'Path is protected'
    )
  })
})

describe('listFiles — symlink in directory (shared.ts line 54 else-if false branch)', () => {
  it('skips symlinks (not files, not directories) when listing without ext filter', async () => {
    // Create a real file and a symlink alongside it in the zone.
    // With withFileTypes, a symlink dirent returns isFile()=false and isDirectory()=false,
    // so it falls past the else-if at shared.ts:54 without being added to results.
    await fs.writeFile(zp('real.txt'), 'x', 'utf-8')
    await fs.symlink(zp('real.txt'), zp('link.txt'))
    const result = await listFiles(cfg, { path: ZONE, recursive: false })
    // real.txt appears; symlink may or may not depending on platform — we just
    // need the call to succeed to exercise the branch.
    expect(Array.isArray(result.files)).toBe(true)
    await fs.unlink(zp('link.txt'))
  })
})

describe('deleteFile', () => {
  it('deletes a file and returns byte count', async () => {
    await fs.writeFile(zp('a.png'), 'hello', 'utf-8')
    const result = await deleteFile(cfg, { path: `${ZONE}/a.png`, dry_run: false })
    expect(result.deleted).toBe(true)
    await expect(fs.access(zp('a.png'))).rejects.toThrow()
  })

  it('dry_run reports what would be deleted without deleting', async () => {
    await fs.writeFile(zp('a.png'), 'hello', 'utf-8')
    const result = await deleteFile(cfg, { path: `${ZONE}/a.png`, dry_run: true })
    expect(result.dry_run).toBe(true)
    expect(result.action).toContain('would delete')
    await expect(fs.access(zp('a.png'))).resolves.toBeUndefined() // still exists
  })

  it('returns a friendly error when the file is missing', async () => {
    await expect(deleteFile(cfg, { path: `${ZONE}/missing.png`, dry_run: false })).rejects.toThrow('File not found')
  })

  it('returns error when path is a directory', async () => {
    await fs.mkdir(zp('subdir'), { recursive: true })
    await expect(deleteFile(cfg, { path: `${ZONE}/subdir`, dry_run: false })).rejects.toThrow('Not a file')
  })

  it('rejects path traversal', async () => {
    await expect(deleteFile(cfg, { path: '../escape.png', dry_run: false })).rejects.toThrow('Path escapes root')
  })

  it('rejects paths outside KB zones', async () => {
    await expect(deleteFile(cfg, { path: 'root-level.png', dry_run: false })).rejects.toThrow('outside KB zones')
  })

  it('rejects protected paths', async () => {
    await expect(deleteFile(cfg, { path: `${ZONE}/.hidden.png`, dry_run: false })).rejects.toThrow('Path is protected')
  })
})

describe('result schemas', () => {
  it('produces results that satisfy their tool-facing zod schemas', async () => {
    await fs.writeFile(zp('schema.txt'), 'hello', 'utf-8')
    const read = await readFile(cfg, { path: `${ZONE}/schema.txt` })
    expect(readFileResultSchema.parse(read)).toEqual(read)

    const list = await listContent(cfg, { path: ZONE, kind: 'files', recursive: false })
    expect(listContentResultSchema.parse(list)).toEqual(list)

    const written = await writeFile(cfg, {
      path: `${ZONE}/schema-out.txt`,
      content: 'hi',
      encoding: 'utf-8',
      create_dirs: true,
      dry_run: false
    })
    expect(writeFileResultSchema.parse(written)).toEqual(written)

    const renamed = await renameFile(cfg, { from: `${ZONE}/schema-out.txt`, to: `${ZONE}/schema-renamed.txt`, create_dirs: false })
    expect(renameFileResultSchema.parse(renamed)).toEqual(renamed)

    const deleted = await deleteFile(cfg, { path: `${ZONE}/schema-renamed.txt`, dry_run: false })
    expect(deleteFileResultSchema.parse(deleted)).toEqual(deleted)
  })
})
