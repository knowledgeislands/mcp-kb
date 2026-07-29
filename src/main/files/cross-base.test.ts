/**
 * Cross-base containment.
 *
 * With one root per process, a traversal bug could only escape into
 * unaddressable territory. With several declared roots in one process the
 * failure mode changes shape: an escape can land *inside a sibling declared
 * base*, which is a confidentiality boundary rather than merely a filesystem
 * one — declared bases span personal, legal and client material.
 *
 * The containment primitives take the root per call, so the risk is not in them
 * but in the wiring. These tests therefore assert the property end to end: given
 * base A, no input of any shape reaches base B's bytes, even though B is
 * declared, readable by the process, and sitting right next to A on disk.
 *
 * The layout is deliberately adversarial: both bases are siblings under one
 * parent, so `../` arithmetic from inside A lands squarely in B.
 */
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { KNOWLEDGE_BASES_ENV_VAR, type KnowledgeBase, loadConfig, selectKnowledgeBase } from '../../config/index.js'
import { createFolder, deleteNote, listNotes, readNote, renameNote, writeNote } from '../notes/index.js'
import { deleteFile, listContent, readFile, renameFile, writeFile } from './index.js'

const PARENT = path.join(os.tmpdir(), 'knowledgeislands-tests', `cross-base-${process.pid}`)
const A_ROOT = path.join(PARENT, 'kb-a')
const B_ROOT = path.join(PARENT, 'kb-b')
const ZONE = 'Pillars'
const SECRET = `${ZONE}/Secret.md`
const SECRET_TEXT = '# b-only secret\n'

let baseA: KnowledgeBase
let baseB: KnowledgeBase

beforeAll(async () => {
  await fs.mkdir(path.join(A_ROOT, ZONE), { recursive: true })
  await fs.mkdir(path.join(B_ROOT, ZONE), { recursive: true })
  await fs.writeFile(path.join(A_ROOT, ZONE, 'Own.md'), '# a own\n', 'utf-8')
  await fs.writeFile(path.join(B_ROOT, ZONE, 'Secret.md'), SECRET_TEXT, 'utf-8')

  const cfg = loadConfig({ [KNOWLEDGE_BASES_ENV_VAR]: JSON.stringify({ 'kb-a': A_ROOT, 'kb-b': B_ROOT }), MCP_KI_KB_FS_AUDIT_LOG: 'off' })
  baseA = selectKnowledgeBase(cfg, 'kb-a')
  baseB = selectKnowledgeBase(cfg, 'kb-b')
})

afterAll(async () => {
  await fs.rm(PARENT, { recursive: true, force: true })
})

/**
 * Every way a caller might try to name base B's secret while acting in base A.
 * `..` arithmetic, an absolute path, a doubled-up traversal, backslash
 * separators, and a traversal that first dips into a real zone directory.
 */
const escapes = (): string[] => [
  `../kb-b/${SECRET}`,
  `${ZONE}/../../kb-b/${SECRET}`,
  `../../${path.basename(PARENT)}/kb-b/${SECRET}`,
  path.join(B_ROOT, SECRET),
  `..\\kb-b\\${ZONE}\\Secret.md`,
  `${ZONE}/./../../kb-b/${SECRET}`
]

describe('relative paths under one alias cannot resolve into another declared base', () => {
  it('refuses every traversal shape on read, and never returns the sibling’s bytes', async () => {
    for (const attempt of escapes()) {
      await expect(readFile(baseA, { path: attempt }), `readFile ${attempt}`).rejects.toThrow()
      await expect(readNote(baseA, { path: attempt }), `readNote ${attempt}`).rejects.toThrow()
    }

    // The same content IS reachable through the alias that declares it — proving
    // the refusals above are about the base boundary, not a missing fixture.
    await expect(readFile(baseB, { path: SECRET })).resolves.toMatchObject({ content: SECRET_TEXT })
  })

  it('refuses every traversal shape on list', async () => {
    for (const attempt of ['../kb-b', `${ZONE}/../../kb-b`, path.join(B_ROOT, ZONE), '..\\kb-b']) {
      await expect(listContent(baseA, { path: attempt, kind: 'files', recursive: true }), `listContent ${attempt}`).rejects.toThrow()
      await expect(listNotes(baseA, { path: attempt, recursive: true }), `listNotes ${attempt}`).rejects.toThrow()
    }
  })

  it('refuses every traversal shape on write, and leaves the sibling base unmodified', async () => {
    for (const attempt of escapes()) {
      await expect(writeFile(baseA, { path: attempt, content: 'overwritten', create_dirs: true, dry_run: false }), `writeFile ${attempt}`).rejects.toThrow()
      await expect(writeNote(baseA, { path: attempt, content: 'overwritten', create_dirs: true, dry_run: false }), `writeNote ${attempt}`).rejects.toThrow()
    }

    await expect(fs.readFile(path.join(B_ROOT, SECRET), 'utf-8')).resolves.toBe(SECRET_TEXT)
  })

  it('refuses every traversal shape on delete, and leaves the sibling base intact', async () => {
    for (const attempt of escapes()) {
      await expect(deleteFile(baseA, { path: attempt, dry_run: false }), `deleteFile ${attempt}`).rejects.toThrow()
      await expect(deleteNote(baseA, { path: attempt, dry_run: false }), `deleteNote ${attempt}`).rejects.toThrow()
    }

    await expect(fs.readFile(path.join(B_ROOT, SECRET), 'utf-8')).resolves.toBe(SECRET_TEXT)
  })

  it('refuses to rename or move content across a base boundary, in either direction', async () => {
    await expect(renameFile(baseA, { from: `${ZONE}/Own.md`, to: `../kb-b/${ZONE}/Stolen.md`, create_dirs: true })).rejects.toThrow()
    await expect(renameNote(baseA, { from: `${ZONE}/Own.md`, to: `../kb-b/${ZONE}/Stolen.md`, create_dirs: true })).rejects.toThrow()
    await expect(renameFile(baseA, { from: `../kb-b/${SECRET}`, to: `${ZONE}/Stolen.md`, create_dirs: true })).rejects.toThrow()
    await expect(renameNote(baseA, { from: `../kb-b/${SECRET}`, to: `${ZONE}/Stolen.md`, create_dirs: true })).rejects.toThrow()

    await expect(fs.access(path.join(B_ROOT, ZONE, 'Stolen.md'))).rejects.toThrow()
    await expect(fs.access(path.join(A_ROOT, ZONE, 'Stolen.md'))).rejects.toThrow()
  })

  it('refuses to create a folder in a sibling base', async () => {
    await expect(createFolder(baseA, { path: `../kb-b/${ZONE}/Planted` })).rejects.toThrow()
    await expect(fs.access(path.join(B_ROOT, ZONE, 'Planted'))).rejects.toThrow()
  })

  it('refuses a symlink inside one base that points into another declared base', async () => {
    // The lexical guard cannot see this one: the path stays under base A until
    // the realpath check resolves it. This is the escape that only matters once
    // a sibling base is also readable by the process.
    const linkPath = path.join(A_ROOT, ZONE, 'link.md')
    await fs.symlink(path.join(B_ROOT, SECRET), linkPath)
    try {
      await expect(readFile(baseA, { path: `${ZONE}/link.md` })).rejects.toThrow('Path escapes root')
      await expect(readNote(baseA, { path: `${ZONE}/link.md` })).rejects.toThrow('Path escapes root')
      await expect(deleteFile(baseA, { path: `${ZONE}/link.md`, dry_run: false })).rejects.toThrow('Path escapes root')
    } finally {
      await fs.rm(linkPath, { force: true })
    }
  })

  it('refuses a symlinked directory inside one base that points at another base’s zone', async () => {
    const linkDir = path.join(A_ROOT, ZONE, 'mirror')
    await fs.symlink(path.join(B_ROOT, ZONE), linkDir)
    try {
      await expect(listContent(baseA, { path: `${ZONE}/mirror`, kind: 'files', recursive: true })).rejects.toThrow('Path escapes root')
      await expect(readFile(baseA, { path: `${ZONE}/mirror/Secret.md` })).rejects.toThrow('Path escapes root')
      await expect(writeFile(baseA, { path: `${ZONE}/mirror/Planted.md`, content: 'x', create_dirs: false, dry_run: false })).rejects.toThrow(
        'Path escapes root'
      )
    } finally {
      await fs.rm(linkDir, { force: true })
    }
    await expect(fs.access(path.join(B_ROOT, ZONE, 'Planted.md'))).rejects.toThrow()
  })

  it('keeps each base’s zone map and allow-list to itself', () => {
    // A base is a closed bundle: root, zones and allow-list travel together, so
    // there is no way to pair one base's root with another's zone configuration.
    expect(baseA.rootPath).toBe(A_ROOT)
    expect(baseB.rootPath).toBe(B_ROOT)
    expect(baseA.alias).toBe('kb-a')
    expect(baseB.alias).toBe('kb-b')
  })
})
