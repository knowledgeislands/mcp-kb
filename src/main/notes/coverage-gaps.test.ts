/**
 * Targeted tests for branches not reached by the main notes test suite:
 *   - writeNote:  non-.md path → "Notes must end in .md" (line 266)
 *   - deleteNote: directory with .md extension → "Not a note file" (line 204)
 *   - deleteNote: path outside KB zones (line 196)
 *   - createFolder: protected path (line 234) and path-exists-as-file (line 241)
 *   - renameNote: destination outside zone (line 147), protected from (line 150),
 *                 protected to (line 153)
 *   - shared.readEntries: non-ENOENT error propagated (line 23)
 *   - shared.collectNotes: isProtectedPath continue branch (line 33)
 */
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { KnowledgeBase } from '../../config/index.js'
import { readEntries } from '../shared.js'
import { createFolder, deleteNote, listNotes, renameNote, writeNote } from './index.js'

const ROOT_PATH = path.join(os.tmpdir(), 'knowledgeislands-tests', `notes-gaps-${process.pid}`)
const ZONE = 'Pillars'
const zp = (...parts: string[]) => path.join(ROOT_PATH, ZONE, ...parts)
const base: KnowledgeBase = {
  alias: 'notes-gaps-kb',
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
  const entries = await fs.readdir(ROOT_PATH)
  await Promise.all(entries.map((e) => fs.rm(path.join(ROOT_PATH, e), { recursive: true, force: true })))
  await fs.mkdir(zp(), { recursive: true })
})

describe('readNote — non-.md path rejection (line 47)', () => {
  it('rejects a .txt path with "Notes must end in .md"', async () => {
    const { readNote } = await import('./index.js')
    await expect(readNote(base, { path: `${ZONE}/note.txt` })).rejects.toThrow('Notes must end in ".md"')
  })
})

describe('listNotes — protected path check (line 87)', () => {
  it('returns "Path is protected" for a dotdir path', async () => {
    await expect(listNotes(base, { path: `${ZONE}/.obsidian`, recursive: false })).rejects.toThrow('Path is protected')
  })
})

describe('listFolders — protected path check (line 113)', () => {
  it('returns "Path is protected" for a dotdir path', async () => {
    const { listFolders } = await import('./index.js')
    await expect(listFolders(base, { path: `${ZONE}/.obsidian`, recursive: false })).rejects.toThrow(
      'Path is protected'
    )
  })
})

describe('renameNote — non-.md from path (line 133)', () => {
  it('rejects a .txt from path with "Notes must end in .md"', async () => {
    await expect(
      renameNote(base, { from: `${ZONE}/note.txt`, to: `${ZONE}/note.md`, create_dirs: false })
    ).rejects.toThrow('Notes must end in ".md"')
  })
})

describe('renameNote — from path outside zone (line 144)', () => {
  it('returns out-of-scope error when from is outside zones', async () => {
    await expect(
      renameNote(base, { from: 'UnknownZone/src.md', to: `${ZONE}/dst.md`, create_dirs: false })
    ).rejects.toThrow('outside KB zones')
  })
})

describe('writeNote — non-.md path rejection (line 266)', () => {
  it('rejects a .txt path with "Notes must end in .md"', async () => {
    await expect(
      writeNote(base, { path: `${ZONE}/note.txt`, content: 'x', create_dirs: false, dry_run: false })
    ).rejects.toThrow('Notes must end in ".md"')
  })

  it('rejects a path with no extension', async () => {
    await expect(
      writeNote(base, { path: `${ZONE}/README`, content: 'x', create_dirs: false, dry_run: false })
    ).rejects.toThrow('Notes must end in ".md"')
  })
})

describe('deleteNote — directory with .md extension (line 204)', () => {
  it('returns "Not a note file" when the .md path is a directory', async () => {
    // Create a directory whose name ends in .md — the protected-path guard allows
    // it (not a dotfile), but stat().isFile() is false, so we hit the error branch.
    await fs.mkdir(zp('dir.md'), { recursive: true })
    await expect(deleteNote(base, { path: `${ZONE}/dir.md`, dry_run: false })).rejects.toThrow('Not a note file')
  })
})

describe('createFolder — protected path (line 234)', () => {
  it('rejects a dotdir path within a zone', async () => {
    await expect(createFolder(base, { path: `${ZONE}/.obsidian` })).rejects.toThrow('Path is protected')
  })
})

describe('createFolder — path exists as file (line 241)', () => {
  it('returns "Path exists as a file, not a folder" when a regular file occupies the path', async () => {
    await fs.writeFile(zp('occupied'), 'x', 'utf-8')
    await expect(createFolder(base, { path: `${ZONE}/occupied` })).rejects.toThrow(
      'Path exists as a file, not a folder'
    )
  })
})

describe('deleteNote — out-of-scope path (line 196)', () => {
  it('returns out-of-scope error for a path in an unknown zone', async () => {
    await expect(deleteNote(base, { path: 'UnknownZone/note.md', dry_run: false })).rejects.toThrow('outside KB zones')
  })
})

describe('renameNote — destination outside zone (line 147)', () => {
  it('returns out-of-scope error when the destination is outside zones', async () => {
    await fs.writeFile(zp('src.md'), 'x', 'utf-8')
    await expect(
      renameNote(base, { from: `${ZONE}/src.md`, to: 'UnknownZone/dst.md', create_dirs: true })
    ).rejects.toThrow('outside KB zones')
  })
})

describe('renameNote — protected from path (line 150)', () => {
  it('returns "Path is protected" for a dotfile source', async () => {
    await expect(
      renameNote(base, { from: `${ZONE}/.secret.md`, to: `${ZONE}/dst.md`, create_dirs: true })
    ).rejects.toThrow('Path is protected')
  })
})

describe('renameNote — protected path (line 153)', () => {
  it('returns "Path is protected" for a dotfile destination', async () => {
    await fs.writeFile(zp('src.md'), 'x', 'utf-8')
    await expect(
      renameNote(base, { from: `${ZONE}/src.md`, to: `${ZONE}/.dst.md`, create_dirs: true })
    ).rejects.toThrow('Path is protected')
  })
})

describe('shared.collectNotes — isProtectedPath continue branch (line 33)', () => {
  it('skips protected entries during a recursive walk', async () => {
    // Write a dotfile inside the zone — collectNotes should skip it via continue (line 33)
    await fs.writeFile(zp('.hidden.md'), 'secret', 'utf-8')
    await fs.writeFile(zp('visible.md'), 'public', 'utf-8')
    const result = await listNotes(base, { path: ZONE, recursive: false })
    expect(result.notes).toEqual([`${ZONE}/visible.md`])
  })
})

describe('shared.readEntries — non-ENOENT error propagated (line 23)', () => {
  it('rethrows a non-ENOENT error for a file used as a directory', async () => {
    // Point readEntries at a regular file — fs.readdir throws ENOTDIR, not ENOENT,
    // so the ENOENT branch is not taken and the error is re-thrown (line 23).
    await fs.writeFile(zp('file.txt'), 'x', 'utf-8')
    await expect(readEntries(ROOT_PATH, zp('file.txt'))).rejects.toThrow()
  })
})
