import * as fs from 'node:fs/promises'
import * as path from 'node:path'

/**
 * Lexical guard: resolve a relative path against a root and reject any
 * traversal that escapes the root (handles "..", absolute-style inputs, etc).
 *
 * This is a fast, FS-free check. Pair with assertRealPathWithinRoot for
 * symlink-aware verification before touching the filesystem.
 */
export const resolveWithinRoot = (root: string, relativePath: string): string => {
  const cleaned = relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
  const resolved = path.resolve(root, cleaned)
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep
  if (resolved !== root && !resolved.startsWith(rootWithSep)) {
    throw new Error(`Path escapes root: "${relativePath}"`)
  }
  return resolved
}

/**
 * Physical guard: resolve symlinks and verify the target really lives inside
 * the root. Catches symlink-based escapes that the lexical check cannot see.
 *
 * For paths that don't exist yet (e.g. a new write target), realpaths the
 * deepest existing ancestor — that ancestor must be inside the realpath of
 * the root.
 */
export const assertRealPathWithinRoot = async (root: string, absPath: string): Promise<void> => {
  const realRoot = await fs.realpath(root)

  let probe = absPath
  while (probe !== path.dirname(probe)) {
    try {
      await fs.access(probe)
      break
    } catch {
      probe = path.dirname(probe)
    }
  }
  const realProbe = await fs.realpath(probe)

  // fs.realpath always strips a trailing separator, so realRoot never ends
  // with one — concatenate unconditionally.
  const realRootWithSep = realRoot + path.sep
  if (realProbe !== realRoot && !realProbe.startsWith(realRootWithSep)) {
    throw new Error(`Path escapes root: "${path.relative(root, absPath)}"`)
  }
}

export const isNodeError = (err: unknown): err is NodeJS.ErrnoException => {
  return err instanceof Error && 'code' in err
}

export const errMessage = (err: unknown): string => {
  return err instanceof Error ? err.message : String(err)
}
