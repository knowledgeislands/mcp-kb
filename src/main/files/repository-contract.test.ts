/**
 * Contract test against this repository as a representative KB root. It proves
 * the allow-list opens only the declared repository-context files and never
 * turns the root into a discoverable or broadly readable area.
 */
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadConfig } from '../../config/index.js'
import { listContent, readFile } from './index.js'

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const cfg = loadConfig({ MCP_KI_KB_FS_ROOT_PATH: REPOSITORY_ROOT, MCP_KI_KB_FS_AUDIT_LOG: 'off' })

describe('repository root-file contract', () => {
  it('reads this repository’s declared context files through kb_read rules', async () => {
    expect(cfg.rootFileAllowlist).toEqual(['README.md', 'AGENTS.md', 'CLAUDE.md'])

    const readme = await readFile(cfg, { path: 'README.md' })
    const claude = await readFile(cfg, { path: 'CLAUDE.md' })

    expect(readme.content).toContain('# mcp-kb-fs')
    expect(claude.content).toContain('Guidance for Claude Code')
  })

  it('does not expose unrelated root files or make the root listable', async () => {
    await expect(readFile(cfg, { path: 'package.json' })).rejects.toThrow(/root_file_allowlist/)
    await expect(listContent(cfg, { path: '', kind: 'files', recursive: false })).rejects.toThrow(/outside KB zones/)
  })
})
