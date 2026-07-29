/**
 * The KB note/folder operations — read / list / write / rename / delete /
 * create-folder — as implementation functions. The tool handlers
 * (src/tools/kb/index.ts) are thin wrappers that call these where Markdown- or
 * folder-specific behaviour is needed. Keeping
 * the logic here (not in the excluded aggregator) makes every branch
 * unit-testable against a real temp KB root.
 *
 * Every entry point takes one already-resolved `KnowledgeBase` as its first
 * argument — never the whole `Config`. The base is chosen once per call in the
 * tool layer, so nothing here can see (or reach into) a second declared base.
 *
 * Layer boundary: every function here returns **plain data** and signals failure
 * by throwing. Mapping to an MCP envelope (`jsonResult` / `errorResult`) is the
 * job of the thin `src/tools/` layer.
 */
import { randomUUID } from 'node:crypto'
import type { Stats } from 'node:fs'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { z } from 'zod'
import type { KnowledgeBase } from '../../config/index.js'
import { isProtectedPath } from '../../utils/protected.js'
import { assertRealPathWithinRoot, isNodeError, resolveWithinRoot } from '../../utils/utils.js'
import { isInScope, outOfScopeError } from '../../utils/zones.js'
import { collectFolders, collectNotes, relativeFromRoot } from '../shared.js'

const NOTE_EXT = '.md'

const isNote = (basename: string): boolean => basename.endsWith(NOTE_EXT)

// Which slice of a note `readNote` returns.
export type NotePart = 'all' | 'frontmatter' | 'body'

export type ReadNoteResult = { path: string; part: NotePart; content: string }
export type ListNotesResult = { path: string; recursive: boolean; count: number; notes: string[] }
export type ListFoldersResult = { path: string; recursive: boolean; count: number; folders: string[] }
export type RenameNoteResult = { from: string; to: string }
export type DeleteNoteResult = { path: string; bytes: number; deleted: boolean; dry_run: boolean; action: string }
export type WriteNoteResult = { path: string; bytes: number; dry_run: boolean; action: string }

/**
 * Shape of the value `createFolder` resolves to, and — via the same schema —
 * the `outputSchema` declared by the `kb_folder_create` tool, so the declared
 * schema and the emitted `structuredContent` cannot drift.
 */
export const createFolderResultSchema = z
  .object({
    path: z.string().describe('The KB-relative folder path that was requested.'),
    existed: z.boolean().describe('True when the folder already existed before the call.'),
    created: z.boolean().describe('True when this call created the folder.')
  })
  .strict()

export type CreateFolderResult = z.infer<typeof createFolderResultSchema>

// Split a note into its YAML frontmatter (the lines between the leading `---`
// fences, fences excluded) and the body after the closing fence. `frontmatter`
// is null when the note has no leading `---` fence; `malformed` is true when it
// opens a fence that never closes (mirrors the kb checker's well-formedness rule).
type FrontmatterSplit = { frontmatter: string | null; body: string; malformed: boolean }
const splitFrontmatter = (content: string): FrontmatterSplit => {
  const lines = content.split('\n')
  if (lines[0]?.trim() !== '---') return { frontmatter: null, body: content, malformed: false }
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === '---') {
      return { frontmatter: lines.slice(1, i).join('\n'), body: lines.slice(i + 1).join('\n'), malformed: false }
    }
  }
  return { frontmatter: null, body: content, malformed: true }
}

export const readNote = async (base: KnowledgeBase, { path: notePath, part = 'all' }: { path: string; part?: NotePart }): Promise<ReadNoteResult> => {
  if (!isNote(notePath)) {
    throw new Error(`Notes must end in "${NOTE_EXT}": "${notePath}"`)
  }
  try {
    const absPath = resolveWithinRoot(base.rootPath, notePath)
    const rel = relativeFromRoot(base.rootPath, absPath)
    if (!isInScope(rel, base.zones)) {
      throw new Error(outOfScopeError(base.zones))
    }
    if (isProtectedPath(rel)) {
      throw new Error(`Path is protected: "${notePath}"`)
    }
    await assertRealPathWithinRoot(base.rootPath, absPath)
    const stat = await fs.stat(absPath)
    if (!stat.isFile()) {
      throw new Error(`Not a note file: "${notePath}"`)
    }
    const content = await fs.readFile(absPath, 'utf-8')
    if (part === 'all') return { path: notePath, part, content }
    const split = splitFrontmatter(content)
    if (split.malformed) {
      throw new Error(`Malformed frontmatter in "${notePath}": opening "---" has no closing "---"`)
    }
    if (part === 'frontmatter') return { path: notePath, part, content: split.frontmatter ?? '(no frontmatter)' }
    return { path: notePath, part, content: split.body }
  } catch (err) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      throw new Error(`File not found: "${notePath}"`)
    }
    throw err
  }
}

export const listNotes = async (base: KnowledgeBase, { path: dirPath, recursive }: { path: string; recursive: boolean }): Promise<ListNotesResult> => {
  const absDir = resolveWithinRoot(base.rootPath, dirPath)
  const rel = relativeFromRoot(base.rootPath, absDir)
  if (rel && !isInScope(rel, base.zones)) {
    throw new Error(outOfScopeError(base.zones))
  }
  if (isProtectedPath(rel)) {
    throw new Error(`Path is protected: "${dirPath}"`)
  }
  await assertRealPathWithinRoot(base.rootPath, absDir)
  const notes = await collectNotes(base.rootPath, absDir, recursive)
  const relative = notes.map((p) => path.relative(base.rootPath, p))
  return { path: dirPath, recursive, count: relative.length, notes: relative }
}

export const listFolders = async (base: KnowledgeBase, { path: dirPath, recursive }: { path: string; recursive: boolean }): Promise<ListFoldersResult> => {
  const absDir = resolveWithinRoot(base.rootPath, dirPath)
  const rel = relativeFromRoot(base.rootPath, absDir)
  if (rel && !isInScope(rel, base.zones)) {
    throw new Error(outOfScopeError(base.zones))
  }
  if (isProtectedPath(rel)) {
    throw new Error(`Path is protected: "${dirPath}"`)
  }
  await assertRealPathWithinRoot(base.rootPath, absDir)
  const folders = await collectFolders(base.rootPath, absDir, recursive)
  const relative = folders.map((p) => path.relative(base.rootPath, p))
  return { path: dirPath, recursive, count: relative.length, folders: relative }
}

export const renameNote = async (
  base: KnowledgeBase,
  { from, to, create_dirs }: { from: string; to: string; create_dirs: boolean }
): Promise<RenameNoteResult> => {
  if (!isNote(from)) {
    throw new Error(`Notes must end in "${NOTE_EXT}": "${from}"`)
  }
  if (!isNote(to)) {
    throw new Error(`Notes must end in "${NOTE_EXT}": "${to}"`)
  }
  try {
    const absFrom = resolveWithinRoot(base.rootPath, from)
    const absTo = resolveWithinRoot(base.rootPath, to)
    const relFrom = relativeFromRoot(base.rootPath, absFrom)
    const relTo = relativeFromRoot(base.rootPath, absTo)
    if (!isInScope(relFrom, base.zones)) {
      throw new Error(outOfScopeError(base.zones))
    }
    if (!isInScope(relTo, base.zones)) {
      throw new Error(outOfScopeError(base.zones))
    }
    if (isProtectedPath(relFrom)) {
      throw new Error(`Path is protected: "${from}"`)
    }
    if (isProtectedPath(relTo)) {
      throw new Error(`Path is protected: "${to}"`)
    }
    if (absFrom === absTo) {
      throw new Error(`Rename source and destination are the same path: "${from}"`)
    }
    await assertRealPathWithinRoot(base.rootPath, absFrom)
    const fromStat = await fs.stat(absFrom)
    if (!fromStat.isFile()) {
      throw new Error(`Not a note file: "${from}"`)
    }
    await assertRealPathWithinRoot(base.rootPath, absTo)
    if (create_dirs) {
      await fs.mkdir(path.dirname(absTo), { recursive: true })
    }
    let destinationExists = false
    try {
      await fs.access(absTo)
      destinationExists = true
    } catch (err) {
      if (!(isNodeError(err) && err.code === 'ENOENT')) throw err
    }
    if (destinationExists) {
      throw new Error(`Destination already exists: "${to}" (rename is non-destructive)`)
    }
    await fs.rename(absFrom, absTo)
    return { from, to }
  } catch (err) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      throw new Error(`File not found: "${from}" — or destination parent missing for "${to}" (set create_dirs: true)`)
    }
    throw err
  }
}

export const deleteNote = async (base: KnowledgeBase, { path: notePath, dry_run }: { path: string; dry_run: boolean }): Promise<DeleteNoteResult> => {
  if (!isNote(notePath)) {
    throw new Error(`Notes must end in "${NOTE_EXT}": "${notePath}"`)
  }
  try {
    const absPath = resolveWithinRoot(base.rootPath, notePath)
    const rel = relativeFromRoot(base.rootPath, absPath)
    if (!isInScope(rel, base.zones)) {
      throw new Error(outOfScopeError(base.zones))
    }
    if (isProtectedPath(rel)) {
      throw new Error(`Path is protected: "${notePath}"`)
    }
    await assertRealPathWithinRoot(base.rootPath, absPath)
    const stat = await fs.stat(absPath)
    if (!stat.isFile()) {
      throw new Error(`Not a note file: "${notePath}"`)
    }
    if (dry_run) {
      return { path: notePath, bytes: stat.size, deleted: false, dry_run: true, action: `would delete (${stat.size} bytes)` }
    }
    await fs.unlink(absPath)
    return { path: notePath, bytes: stat.size, deleted: true, dry_run: false, action: `deleted (${stat.size} bytes)` }
  } catch (err) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      throw new Error(`File not found: "${notePath}"`)
    }
    throw err
  }
}

export const createFolder = async (base: KnowledgeBase, { path: dirPath }: { path: string }): Promise<CreateFolderResult> => {
  if (!dirPath) {
    throw new Error('Folder path must not be empty')
  }
  const absDir = resolveWithinRoot(base.rootPath, dirPath)
  const rel = relativeFromRoot(base.rootPath, absDir)
  if (!isInScope(rel, base.zones)) {
    throw new Error(outOfScopeError(base.zones))
  }
  if (isProtectedPath(rel)) {
    throw new Error(`Path is protected: "${dirPath}"`)
  }
  await assertRealPathWithinRoot(base.rootPath, absDir)
  let existing: Stats | null = null
  try {
    existing = await fs.stat(absDir)
  } catch (err) {
    if (!(isNodeError(err) && err.code === 'ENOENT')) throw err
  }
  if (existing?.isFile()) {
    throw new Error(`Path exists as a file, not a folder: "${dirPath}"`)
  }
  const existed = existing?.isDirectory() === true
  await fs.mkdir(absDir, { recursive: true })
  return { path: dirPath, existed, created: !existed }
}

export const writeNote = async (
  base: KnowledgeBase,
  { path: notePath, content, create_dirs, dry_run }: { path: string; content: string; create_dirs: boolean; dry_run: boolean }
): Promise<WriteNoteResult> => {
  if (!isNote(notePath)) {
    throw new Error(`Notes must end in "${NOTE_EXT}": "${notePath}"`)
  }
  try {
    const absPath = resolveWithinRoot(base.rootPath, notePath)
    const rel = relativeFromRoot(base.rootPath, absPath)
    if (!isInScope(rel, base.zones)) {
      throw new Error(outOfScopeError(base.zones))
    }
    if (isProtectedPath(rel)) {
      throw new Error(`Path is protected: "${notePath}"`)
    }
    // Realpath-guard BEFORE creating any directory — a symlinked ancestor must be
    // caught before `mkdir -p` can materialise dirs at its target.
    await assertRealPathWithinRoot(base.rootPath, absPath)
    if (create_dirs && !dry_run) {
      await fs.mkdir(path.dirname(absPath), { recursive: true })
    }
    const bytes = Buffer.byteLength(content, 'utf-8')
    if (dry_run) {
      let exists = false
      let existingBytes = 0
      try {
        const stat = await fs.stat(absPath)
        exists = stat.isFile()
        existingBytes = stat.size
      } catch (err) {
        if (!(isNodeError(err) && err.code === 'ENOENT')) throw err
      }
      const action = exists ? `would overwrite (${existingBytes} → ${bytes} bytes)` : `would create (${bytes} bytes)`
      return { path: notePath, bytes, dry_run: true, action }
    }
    // Atomic write: write a sibling temp file then rename over the target, so a
    // crash mid-write can't leave a note half-rewritten. rename() is atomic within a dir.
    const tmpPath = `${absPath}.${randomUUID()}.tmp`
    await fs.writeFile(tmpPath, content, 'utf-8')
    await fs.rename(tmpPath, absPath)
    return { path: notePath, bytes, dry_run: false, action: `wrote (${bytes} bytes)` }
  } catch (err) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      throw new Error(`Directory not found for: "${notePath}" — set create_dirs: true to create it automatically`)
    }
    throw err
  }
}
