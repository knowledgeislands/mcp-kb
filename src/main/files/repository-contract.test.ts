/**
 * Contract test against this repository as a representative KB root. It proves
 * the allow-list opens only the declared repository-context files and never
 * turns the root into a discoverable or broadly readable area.
 */
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { KNOWLEDGE_BASES_ENV_VAR, loadConfig, selectKnowledgeBase } from '../../config/index.js'
import { listContent, readFile } from './index.js'

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
// Declared exactly as an install would declare it: one alias, resolved through
// the same selection helper the tool layer uses.
const cfg = loadConfig({ [KNOWLEDGE_BASES_ENV_VAR]: JSON.stringify({ 'this-repo': REPOSITORY_ROOT }), MCP_KI_KB_FS_AUDIT_LOG: 'off' })
const base = selectKnowledgeBase(cfg, 'this-repo')

describe('repository root-file contract', () => {
  it('reads this repository’s declared context files through kb_read rules', async () => {
    expect(base.rootFileAllowlist).toEqual(['README.md', 'AGENTS.md', 'CLAUDE.md'])

    const readme = await readFile(base, { path: 'README.md' })
    const claude = await readFile(base, { path: 'CLAUDE.md' })

    expect(readme.content).toContain('# mcp-kb-fs')
    expect(claude.content).toContain('Guidance for Claude Code')
  })

  it('does not expose unrelated root files or make the root listable', async () => {
    await expect(readFile(base, { path: 'package.json' })).rejects.toThrow(/root_file_allowlist/)
    await expect(listContent(base, { path: '', kind: 'files', recursive: false })).rejects.toThrow(/outside KB zones/)
  })
})
