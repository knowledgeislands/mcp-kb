import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { type Config, selectKnowledgeBase } from '../../config/index.js'
import * as files from '../../main/files/index.js'
import * as notes from '../../main/notes/index.js'
import { DESTRUCTIVE, READ_ONLY, WRITE, WRITE_IDEMPOTENT } from '../../utils/annotations.js'
import { errorResult, jsonResult } from '../../utils/results.js'
import { kbArg } from '../shared.js'

const NO_TRAVERSAL_MSG = 'Must be a KB-relative path: no ".." segments, no leading "/", no leading "~", no null bytes'

const isKbRelative = (value: string): boolean =>
  !value.split(/[\\/]/).includes('..') && !value.startsWith('/') && !value.startsWith('~') && !value.includes('\0')

const filePathArg = (describe: string) =>
  z.string().min(1, 'Path must not be empty').max(4096).refine(isKbRelative, NO_TRAVERSAL_MSG).describe(describe)

const dirPathArg = (describe: string) => filePathArg(describe)

const listInputSchema = (cfg: Config) =>
  z
    .object({
      kb: kbArg(cfg),
      path: dirPathArg('Declared zone or staging-root directory, e.g. "Pillars" or "+".'),
      kind: z.enum(['files', 'folders', 'notes']).default('files').describe('What to return. Default files.'),
      recursive: z.boolean().default(false).describe('Descend into subdirectories. Default false.'),
      ext: z
        .string()
        .regex(/^\.[a-zA-Z0-9]+$/, 'Extension must start with a dot, e.g. ".png"')
        .optional()
        .describe('File extension filter, e.g. ".png". Valid only when kind is files.')
    })
    .strict()
    .superRefine((value, ctx) => {
      if (value.kind !== 'files' && value.ext !== undefined) {
        ctx.addIssue({ code: 'custom', message: 'ext is valid only when kind is "files".', path: ['ext'] })
      }
    })

export const registerKbTools = (server: McpServer, cfg: Config): void => {
  server.registerTool(
    'kb_delete',
    {
      title: 'Delete KB Content',
      description:
        'Delete a file from a declared KB zone or staging root. dry_run defaults to true; root-file allow-list entries are never deletable.',
      inputSchema: z
        .object({
          kb: kbArg(cfg),
          path: filePathArg('KB-relative file path in a declared zone or staging root.'),
          dry_run: z.boolean().default(true).describe('Preview without deleting. Default true.')
        })
        .strict(),
      outputSchema: files.deleteFileResultSchema,
      annotations: DESTRUCTIVE
    },
    async ({ kb, ...args }) => {
      try {
        return jsonResult(await files.deleteFile(selectKnowledgeBase(cfg, kb), args))
      } catch (err) {
        return errorResult('deleting file', err)
      }
    }
  )

  server.registerTool(
    'kb_folder_create',
    {
      title: 'Create KB Folder',
      description:
        'Create a folder in a declared KB zone or staging root. Idempotent: succeeds when the folder already exists.',
      inputSchema: z
        .object({ kb: kbArg(cfg), path: filePathArg('KB-relative folder path in a declared zone or staging root.') })
        .strict(),
      outputSchema: notes.createFolderResultSchema,
      annotations: WRITE_IDEMPOTENT
    },
    async ({ kb, ...args }) => {
      try {
        return jsonResult(await notes.createFolder(selectKnowledgeBase(cfg, kb), args))
      } catch (err) {
        return errorResult('creating folder', err)
      }
    }
  )

  server.registerTool(
    'kb_list',
    {
      title: 'List KB Content',
      description: `List files, folders, or Markdown notes under one declared zone or staging root.

Returns a JSON object with entries and count. The KB root and configured
root-file allow-list are never listable.`,
      inputSchema: listInputSchema(cfg),
      outputSchema: files.listContentResultSchema,
      annotations: READ_ONLY
    },
    async ({ kb, ...args }) => {
      try {
        return jsonResult(await files.listContent(selectKnowledgeBase(cfg, kb), args))
      } catch (err) {
        return errorResult('listing content', err)
      }
    }
  )

  server.registerTool(
    'kb_read',
    {
      title: 'Read KB Content',
      description: `Read one KB file and return its path, MIME type, encoding, size, and content.

UTF-8 files return text; binary files return base64. For a Markdown file, part
may select all content, YAML frontmatter, or body. Paths must be in a declared
zone or staging root, except exact read-only entries in root_file_allowlist.
The exception neither lists the root nor permits writes.`,
      inputSchema: z
        .object({
          kb: kbArg(cfg),
          path: filePathArg(
            'KB-relative path, e.g. "Pillars/Finance/Budget.md" or an exact configured root-file path.'
          ),
          part: z
            .enum(['all', 'frontmatter', 'body'])
            .default('all')
            .describe('For UTF-8 Markdown only: whole file, YAML frontmatter, or body. Default all.')
        })
        .strict(),
      outputSchema: files.readFileResultSchema,
      annotations: READ_ONLY
    },
    async ({ kb, ...args }) => {
      try {
        return jsonResult(await files.readFile(selectKnowledgeBase(cfg, kb), args))
      } catch (err) {
        return errorResult('reading file', err)
      }
    }
  )

  server.registerTool(
    'kb_rename',
    {
      title: 'Rename KB Content',
      description:
        'Rename or move a file within declared KB zones or staging roots. Refuses to overwrite an existing destination.',
      inputSchema: z
        .object({
          kb: kbArg(cfg),
          from: filePathArg('Current KB-relative file path.'),
          to: filePathArg('New KB-relative file path.'),
          create_dirs: z.boolean().default(true).describe('Create destination parent directories. Default true.')
        })
        .strict(),
      outputSchema: files.renameFileResultSchema,
      annotations: WRITE
    },
    async ({ kb, ...args }) => {
      try {
        return jsonResult(await files.renameFile(selectKnowledgeBase(cfg, kb), args))
      } catch (err) {
        return errorResult('renaming file', err)
      }
    }
  )

  server.registerTool(
    'kb_write',
    {
      title: 'Write KB Content',
      description: `Create or overwrite a file in a declared KB zone or staging root.

Use UTF-8 content for text and base64 for binary data. Writes are atomic; dry_run
defaults to true. Root-file allow-list entries are never writable.`,
      inputSchema: z
        .object({
          kb: kbArg(cfg),
          path: filePathArg('KB-relative path in a declared zone or staging root.'),
          content: z
            .string()
            .max(50 * 1024 * 1024)
            .describe('UTF-8 text or base64-encoded bytes, according to encoding.'),
          encoding: z.enum(['utf-8', 'base64']).default('utf-8').describe('Content encoding. Default utf-8.'),
          create_dirs: z.boolean().default(true).describe('Create missing parent directories. Default true.'),
          dry_run: z.boolean().default(true).describe('Preview without writing. Default true.')
        })
        .strict(),
      outputSchema: files.writeFileResultSchema,
      annotations: DESTRUCTIVE
    },
    async ({ kb, ...args }) => {
      try {
        return jsonResult(await files.writeFile(selectKnowledgeBase(cfg, kb), args))
      } catch (err) {
        return errorResult('writing file', err)
      }
    }
  )
}
