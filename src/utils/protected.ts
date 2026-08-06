import * as path from 'node:path'

const META_STEMS = new Set([
  'readme',
  'claude',
  'license',
  'changelog',
  'contributing',
  'security',
  'code_of_conduct',
  'agents'
])
const META_EXTS = new Set(['.md', '.txt'])

const isMetaBasename = (basename: string): boolean => {
  const lower = basename.toLowerCase()
  if (META_STEMS.has(lower)) return true
  const ext = path.extname(lower)
  if (META_EXTS.has(ext)) {
    return META_STEMS.has(lower.slice(0, -ext.length))
  }
  return false
}

const splitSegments = (relPath: string): string[] => {
  return relPath.replace(/\\/g, '/').split('/').filter(Boolean)
}

/**
 * Decide whether a KB-relative path should be hidden from MCP tools.
 *
 * Two rules:
 *   1. Any path segment beginning with "." is protected at any depth (universal
 *      dotfile convention — covers .git, .obsidian, .DS_Store, .env, etc).
 *   2. Repo-meta basenames (README, CLAUDE, LICENSE, CHANGELOG, CONTRIBUTING,
 *      SECURITY, CODE_OF_CONDUCT, AGENTS — case-insensitive, with optional
 *      .md/.txt extension) are protected only at the KB root, so a deliberate
 *      nested note like "archive/2020/README.md" remains accessible.
 *
 * The empty string (KB root) is not protected.
 */
export const isProtectedPath = (relPath: string): boolean => {
  const segments = splitSegments(relPath)
  const [first] = segments
  if (first === undefined) return false
  if (segments.some((s) => s.startsWith('.'))) return true
  if (segments.length === 1 && isMetaBasename(first)) return true
  return false
}
