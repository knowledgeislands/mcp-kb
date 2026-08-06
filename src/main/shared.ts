/**
 * Shared filesystem walk helpers used by both the notes and files modules.
 */
import type { Dirent } from 'node:fs'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { isProtectedPath } from '../utils/protected.js'
import { isNodeError } from '../utils/utils.js'

export const MAX_WALK_DEPTH = 32

export const isUnwalkableDir = (name: string): boolean => name === 'node_modules'

export const relativeFromRoot = (rootPath: string, absPath: string): string => path.relative(rootPath, absPath)

export const readEntries = async (rootPath: string, dir: string): Promise<Dirent[]> => {
  try {
    return (await fs.readdir(dir, { withFileTypes: true, encoding: 'utf-8' })) as Dirent[]
  } catch (err) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      throw new Error(`Directory not found: "${path.relative(rootPath, dir)}"`)
    }
    throw err
  }
}

export const collectNotes = async (rootPath: string, dir: string, recursive: boolean, depth = 0): Promise<string[]> => {
  const entries = await readEntries(rootPath, dir)
  const results: string[] = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    const rel = relativeFromRoot(rootPath, full)
    if (isProtectedPath(rel)) continue
    if (entry.isDirectory()) {
      if (recursive && depth < MAX_WALK_DEPTH && !isUnwalkableDir(entry.name)) {
        results.push(...(await collectNotes(rootPath, full, true, depth + 1)))
      }
    } else if (entry.isFile() && rel.endsWith('.md')) {
      results.push(full)
    }
  }
  return results
}

export const collectFiles = async (
  rootPath: string,
  dir: string,
  recursive: boolean,
  ext: string | null,
  depth = 0
): Promise<string[]> => {
  const entries = await readEntries(rootPath, dir)
  const results: string[] = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    const rel = relativeFromRoot(rootPath, full)
    if (isProtectedPath(rel)) continue
    if (entry.isDirectory()) {
      if (recursive && depth < MAX_WALK_DEPTH && !isUnwalkableDir(entry.name)) {
        results.push(...(await collectFiles(rootPath, full, recursive, ext, depth + 1)))
      }
    } else if (entry.isFile()) {
      if (ext === null || entry.name.endsWith(ext)) {
        results.push(full)
      }
    }
  }
  return results
}

export const collectFolders = async (
  rootPath: string,
  dir: string,
  recursive: boolean,
  depth = 0
): Promise<string[]> => {
  const entries = await readEntries(rootPath, dir)
  const results: string[] = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    const rel = relativeFromRoot(rootPath, full)
    if (isProtectedPath(rel)) continue
    if (entry.isDirectory() && !isUnwalkableDir(entry.name)) {
      results.push(full)
      if (recursive && depth < MAX_WALK_DEPTH) {
        results.push(...(await collectFolders(rootPath, full, true, depth + 1)))
      }
    }
  }
  return results
}
