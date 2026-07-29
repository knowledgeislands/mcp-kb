/**
 * Side-file operations — read / list / write / rename / delete — for non-markdown
 * assets (images, PDFs, attachments, etc.) that live alongside notes within KB zones.
 *
 * Key differences from the notes module:
 * - No `.md` extension restriction.
 * - Binary-safe reads: content returned as base64 when not valid UTF-8.
 * - Write accepts `encoding: 'utf-8' | 'base64'`; base64 is decoded to bytes before
 *   writing so binary assets round-trip cleanly.
 * - Zone-scoping guard applied before `isProtectedPath`.
 *
 * Layer boundary: every function here returns **plain data** and signals failure
 * by throwing. Mapping to an MCP envelope (`jsonResult` / `errorResult`) is the
 * job of the thin `src/tools/` layer.
 */
import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { z } from 'zod'
import type { Config } from '../../config/index.js'
import { isProtectedPath } from '../../utils/protected.js'
import { assertRealPathWithinRoot, isNodeError, resolveWithinRoot } from '../../utils/utils.js'
import { isInScope, outOfScopeError } from '../../utils/zones.js'
import { collectFiles, collectFolders, collectNotes, relativeFromRoot } from '../shared.js'

// Minimal extension → MIME map for the most common KB side-file types.
// Falls back to application/octet-stream for anything unrecognised.
const MIME_MAP: Record<string, string> = {
  '.md': 'text/markdown',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.json': 'application/json',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml'
}

const mimeTypeFor = (filePath: string): string => {
  const ext = path.extname(filePath).toLowerCase()
  return MIME_MAP[ext] ?? 'application/octet-stream'
}

const isUtf8 = (buf: Buffer): boolean => {
  try {
    const decoded = buf.toString('utf-8')
    return Buffer.from(decoded, 'utf-8').equals(buf)
  } catch {
    // buf.toString() does not throw in Node.js; this is a defensive fallback.
    /* v8 ignore next */
    return false
  }
}

export type ReadPart = 'all' | 'frontmatter' | 'body'
export type ListKind = 'files' | 'folders' | 'notes'

/**
 * Result schemas for the tool-facing entry points.
 *
 * Each schema is the **single source** for two things: the TypeScript return
 * type of the `main/` function (via `z.infer`) and the `outputSchema` the
 * matching `src/tools/kb` registration declares. Because the tool handler feeds
 * the very same value into `jsonResult`, the advertised JSON Schema and the
 * emitted `structuredContent` cannot drift apart.
 */
export const readFileResultSchema = z
  .object({
    path: z.string().describe('The KB-relative path that was read, exactly as requested.'),
    part: z.enum(['all', 'frontmatter', 'body']).describe('Which slice of the file was returned.'),
    encoding: z.enum(['utf-8', 'base64']).describe('How content is encoded: utf-8 for text, base64 for binary.'),
    mimeType: z.string().describe('MIME type derived from the file extension; application/octet-stream when unrecognised.'),
    content: z.string().describe('File content in the stated encoding.'),
    size: z.number().describe('Size of the whole file on disk, in bytes.')
  })
  .strict()

export type ReadFileResult = z.infer<typeof readFileResultSchema>

export const listContentResultSchema = z
  .object({
    path: z.string().describe('The KB-relative directory that was listed, exactly as requested.'),
    kind: z.enum(['files', 'folders', 'notes']).describe('What kind of entry was listed.'),
    recursive: z.boolean().describe('Whether subdirectories were descended into.'),
    ext: z.string().nullable().describe('Extension filter applied, or null when none applied.'),
    count: z.number().describe('Number of entries returned.'),
    entries: z.array(z.string()).describe('KB-relative paths of the matching entries.')
  })
  .strict()

export type ListContentResult = z.infer<typeof listContentResultSchema>

export type ListFilesResult = {
  path: string
  recursive: boolean
  ext: string | null
  count: number
  files: string[]
}

export const writeFileResultSchema = z
  .object({
    path: z.string().describe('The KB-relative path that was written, exactly as requested.'),
    encoding: z.enum(['utf-8', 'base64']).describe('Encoding the supplied content was interpreted as.'),
    bytes: z.number().describe('Byte length of the decoded content.'),
    dry_run: z.boolean().describe('True when nothing was written because the call was a preview.'),
    action: z.string().describe('Human-readable summary of what was (or would be) done.')
  })
  .strict()

export type WriteFileResult = z.infer<typeof writeFileResultSchema>

export const renameFileResultSchema = z
  .object({
    from: z.string().describe('The KB-relative source path.'),
    to: z.string().describe('The KB-relative destination path.')
  })
  .strict()

export type RenameFileResult = z.infer<typeof renameFileResultSchema>

export const deleteFileResultSchema = z
  .object({
    path: z.string().describe('The KB-relative path that was deleted, exactly as requested.'),
    bytes: z.number().describe('Size of the file at the time of the call, in bytes.'),
    deleted: z.boolean().describe('True when the file was actually removed.'),
    dry_run: z.boolean().describe('True when nothing was deleted because the call was a preview.'),
    action: z.string().describe('Human-readable summary of what was (or would be) done.')
  })
  .strict()

export type DeleteFileResult = z.infer<typeof deleteFileResultSchema>

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

export const readFile = async (cfg: Config, { path: filePath, part = 'all' }: { path: string; part?: ReadPart }): Promise<ReadFileResult> => {
  try {
    const absPath = resolveWithinRoot(cfg.rootPath, filePath)
    const rel = relativeFromRoot(cfg.rootPath, absPath).split(path.sep).join('/')
    const isAllowlistedRootFile = filePath.replaceAll('\\', '/') === rel && cfg.rootFileAllowlist.includes(rel)
    if (!isInScope(rel, cfg.zones) && !isAllowlistedRootFile) {
      throw new Error(`${outOfScopeError(cfg.zones)} Root-level and named near-root files must exactly match root_file_allowlist.`)
    }
    if (isProtectedPath(rel) && !isAllowlistedRootFile) {
      throw new Error(`Path is protected: "${filePath}"`)
    }
    await assertRealPathWithinRoot(cfg.rootPath, absPath)
    const stat = await fs.stat(absPath)
    if (!stat.isFile()) {
      throw new Error(`Not a file: "${filePath}"`)
    }
    const buf = await fs.readFile(absPath)
    const mimeType = mimeTypeFor(filePath)
    if (isUtf8(buf)) {
      const content = buf.toString('utf-8')
      if (part !== 'all') {
        if (path.extname(filePath).toLowerCase() !== '.md') {
          throw new Error(`part is only available for UTF-8 Markdown files: "${filePath}"`)
        }
        const split = splitFrontmatter(content)
        if (split.malformed) {
          throw new Error(`Malformed frontmatter in "${filePath}": opening "---" has no closing "---"`)
        }
        return {
          path: filePath,
          part,
          encoding: 'utf-8',
          mimeType,
          content: part === 'frontmatter' ? (split.frontmatter ?? '(no frontmatter)') : split.body,
          size: stat.size
        }
      }
      return { path: filePath, part, encoding: 'utf-8', mimeType, content, size: stat.size }
    }
    if (part !== 'all') {
      throw new Error(`part is only available for UTF-8 Markdown files: "${filePath}"`)
    }
    return { path: filePath, part, encoding: 'base64', mimeType, content: buf.toString('base64'), size: stat.size }
  } catch (err) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      throw new Error(`File not found: "${filePath}"`)
    }
    throw err
  }
}

export const listContent = async (
  cfg: Config,
  { path: dirPath, kind, recursive, ext }: { path: string; kind: ListKind; recursive: boolean; ext?: string }
): Promise<ListContentResult> => {
  const absDir = resolveWithinRoot(cfg.rootPath, dirPath)
  const rel = relativeFromRoot(cfg.rootPath, absDir)
  if (!isInScope(rel, cfg.zones)) {
    throw new Error(outOfScopeError(cfg.zones))
  }
  if (isProtectedPath(rel)) {
    throw new Error(`Path is protected: "${dirPath}"`)
  }
  await assertRealPathWithinRoot(cfg.rootPath, absDir)
  const paths =
    kind === 'files'
      ? await collectFiles(cfg.rootPath, absDir, recursive, ext ?? null)
      : kind === 'folders'
        ? await collectFolders(cfg.rootPath, absDir, recursive)
        : await collectNotes(cfg.rootPath, absDir, recursive)
  const entries = paths.map((entry) => path.relative(cfg.rootPath, entry))
  return { path: dirPath, kind, recursive, ext: kind === 'files' ? (ext ?? null) : null, count: entries.length, entries }
}

export const listFiles = async (
  cfg: Config,
  { path: dirPath, recursive, ext }: { path: string; recursive: boolean; ext?: string }
): Promise<ListFilesResult> => {
  const absDir = resolveWithinRoot(cfg.rootPath, dirPath)
  const rel = relativeFromRoot(cfg.rootPath, absDir)
  if (rel && !isInScope(rel, cfg.zones)) {
    throw new Error(outOfScopeError(cfg.zones))
  }
  if (isProtectedPath(rel)) {
    throw new Error(`Path is protected: "${dirPath}"`)
  }
  await assertRealPathWithinRoot(cfg.rootPath, absDir)
  const files = await collectFiles(cfg.rootPath, absDir, recursive, ext ?? null)
  const relative = files.map((p) => path.relative(cfg.rootPath, p))
  return { path: dirPath, recursive, ext: ext ?? null, count: relative.length, files: relative }
}

export type FileEncoding = 'utf-8' | 'base64'

export const writeFile = async (
  cfg: Config,
  {
    path: filePath,
    content,
    encoding = 'utf-8',
    create_dirs,
    dry_run
  }: {
    path: string
    content: string
    encoding?: FileEncoding
    create_dirs: boolean
    dry_run: boolean
  }
): Promise<WriteFileResult> => {
  try {
    const absPath = resolveWithinRoot(cfg.rootPath, filePath)
    const rel = relativeFromRoot(cfg.rootPath, absPath)
    if (!isInScope(rel, cfg.zones)) {
      throw new Error(outOfScopeError(cfg.zones))
    }
    if (isProtectedPath(rel)) {
      throw new Error(`Path is protected: "${filePath}"`)
    }
    await assertRealPathWithinRoot(cfg.rootPath, absPath)
    const buf = encoding === 'base64' ? Buffer.from(content, 'base64') : Buffer.from(content, 'utf-8')
    const bytes = buf.byteLength
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
      return { dry_run: true, action, path: filePath, encoding, bytes }
    }
    if (create_dirs) {
      await fs.mkdir(path.dirname(absPath), { recursive: true })
    }
    // Atomic write via sibling temp file + rename.
    const tmpPath = `${absPath}.${randomUUID()}.tmp`
    await fs.writeFile(tmpPath, buf)
    await fs.rename(tmpPath, absPath)
    return { dry_run: false, action: `wrote (${bytes} bytes)`, path: filePath, encoding, bytes }
  } catch (err) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      throw new Error(`Directory not found for: "${filePath}" — set create_dirs: true to create it automatically`)
    }
    throw err
  }
}

export const renameFile = async (cfg: Config, { from, to, create_dirs }: { from: string; to: string; create_dirs: boolean }): Promise<RenameFileResult> => {
  try {
    const absFrom = resolveWithinRoot(cfg.rootPath, from)
    const absTo = resolveWithinRoot(cfg.rootPath, to)
    const relFrom = relativeFromRoot(cfg.rootPath, absFrom)
    const relTo = relativeFromRoot(cfg.rootPath, absTo)
    if (!isInScope(relFrom, cfg.zones)) {
      throw new Error(outOfScopeError(cfg.zones))
    }
    if (!isInScope(relTo, cfg.zones)) {
      throw new Error(outOfScopeError(cfg.zones))
    }
    if (isProtectedPath(relFrom)) {
      throw new Error(`Path is protected: "${from}"`)
    }
    if (isProtectedPath(relTo)) {
      throw new Error(`Path is protected: "${to}"`)
    }
    if (absFrom === absTo) {
      throw new Error(`Source and destination are the same: "${from}"`)
    }
    await assertRealPathWithinRoot(cfg.rootPath, absFrom)
    const fromStat = await fs.stat(absFrom)
    if (!fromStat.isFile()) {
      throw new Error(`Not a file: "${from}"`)
    }
    await assertRealPathWithinRoot(cfg.rootPath, absTo)
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
      throw new Error(`File not found: "${from}" — set create_dirs: true if the destination directory does not exist`)
    }
    throw err
  }
}

export const deleteFile = async (cfg: Config, { path: filePath, dry_run }: { path: string; dry_run: boolean }): Promise<DeleteFileResult> => {
  try {
    const absPath = resolveWithinRoot(cfg.rootPath, filePath)
    const rel = relativeFromRoot(cfg.rootPath, absPath)
    if (!isInScope(rel, cfg.zones)) {
      throw new Error(outOfScopeError(cfg.zones))
    }
    if (isProtectedPath(rel)) {
      throw new Error(`Path is protected: "${filePath}"`)
    }
    await assertRealPathWithinRoot(cfg.rootPath, absPath)
    const stat = await fs.stat(absPath)
    if (!stat.isFile()) {
      throw new Error(`Not a file: "${filePath}"`)
    }
    if (dry_run) {
      return { dry_run: true, deleted: false, action: `would delete (${stat.size} bytes)`, path: filePath, bytes: stat.size }
    }
    await fs.unlink(absPath)
    return { dry_run: false, deleted: true, action: `deleted (${stat.size} bytes)`, path: filePath, bytes: stat.size }
  } catch (err) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      throw new Error(`File not found: "${filePath}"`)
    }
    throw err
  }
}
