// Generated on 2026-07-22T14:52:47.075Z by @knowledgeislands/mcp-ki-kb-fs@1.0.0
// Server: mcp-ki-kb-mcp-ki-kb-fs
// Source: /Users/krisbrown/.mcporter/mcporter.json
// Transport: STDIO /Users/krisbrown/.local/share/mise/installs/node/lts/bin/node /Users/krisbrown/workspaces/kis/knowledgeislands/mcp-ki-kb-fs/dist/mcp-server/index.js

import type { CallResult } from 'mcporter';

export interface McpKiKbMcpKiKbFsTools {
  /**
   * Read one KB file and return its path, MIME type, encoding, size, and content.
   * UTF-8 files return text; binary files return base64. For a Markdown file, part
   * may select all content, YAML frontmatter, or body. Paths must be in a declared
   * zone or staging root, except exact read-only entries in root_file_allowlist.
   * The exception neither lists the root nor permits writes.
   *
   * @param path KB-relative path, e.g. "Pillars/Finance/Budget.md" or an exact configured root-file
   *             path.
   * @param part? For UTF-8 Markdown only: whole file, YAML frontmatter, or body. Default all.
   */
  kb_read(path: string, part?: "all" | "frontmatter" | "body"): Promise<CallResult>;

  /**
   * List files, folders, or Markdown notes under one declared zone or staging root.
   * Returns a JSON object with entries and count. The KB root and configured
   * root-file allow-list are never listable.
   *
   * @param path Declared zone or staging-root directory, e.g. "Pillars" or "+".
   * @param kind? What to return. Default files.
   * @param recursive? Descend into subdirectories. Default false.
   * @param ext? File extension filter, e.g. ".png". Valid only when kind is files.
   */
  kb_list(path: string, kind?: "files" | "folders" | "notes", recursive?: boolean, ext?: string): Promise<CallResult>;

  /**
   * Create or overwrite a file in a declared KB zone or staging root.
   * Use UTF-8 content for text and base64 for binary data. Writes are atomic; dry_run
   * defaults to true. Root-file allow-list entries are never writable.
   *
   * @param path KB-relative path in a declared zone or staging root.
   * @param content UTF-8 text or base64-encoded bytes, according to encoding.
   * @param encoding? Content encoding. Default utf-8.
   * @param create_dirs? Create missing parent directories. Default true.
   * @param dry_run? Preview without writing. Default true.
   */
  kb_write(path: string, content: string, encoding?: "utf-8" | "base64", create_dirs?: boolean, dry_run?: boolean): Promise<CallResult>;

  /**
   * Rename or move a file within declared KB zones or staging roots. Refuses to overwrite an existing
   * destination.
   *
   * @param from Current KB-relative file path.
   * @param to New KB-relative file path.
   * @param create_dirs? Create destination parent directories. Default true.
   */
  kb_rename(from: string, to: string, create_dirs?: boolean): Promise<CallResult>;

  /**
   * Delete a file from a declared KB zone or staging root. dry_run defaults to true; root-file
   * allow-list entries are never deletable.
   *
   * @param path KB-relative file path in a declared zone or staging root.
   * @param dry_run? Preview without deleting. Default true.
   */
  kb_delete(path: string, dry_run?: boolean): Promise<CallResult>;

  /**
   * Create a folder in a declared KB zone or staging root. Idempotent: succeeds when the folder already
   * exists.
   *
   * @param path KB-relative folder path in a declared zone or staging root.
   */
  kb_folder_create(path: string): Promise<CallResult>;

  /**
   * Return the Knowledge Islands configuration for this KB: resolved zone names,
   * staging area names, the root-file read allow-list, and the raw .ki.toml content.
   * Use this as an orientation step when working with an unfamiliar KB — it tells
   * you which top-level folders correspond to each canonical zone (Calendar, Pillars,
   * Resources, Streams, Admin) and which staging areas (+/ and -/) are configured.
   * The zone map is derived from .ki.toml at server startup; if the file is
   * absent, all zones use their canonical defaults.
   * Takes no parameters. Returns a JSON object with:
   * - zones: { Calendar, Pillars, Resources, Streams, Admin }
   * - staging: { inbound, outbound }
   * - rootFileAllowlist (exact paths available through kb_read)
   * - kiConfigPresent (boolean)
   * - kiConfigRaw (string — raw TOML or "(absent — all zones are defaults)")
   */
  kb_config(): Promise<CallResult>;
}

