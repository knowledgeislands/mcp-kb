/**
 * Argument shapes shared by every tool group.
 *
 * `kb` is the one argument all seven tools have in common, so it is declared
 * once here rather than restated per group — a second definition could drift
 * into accepting an alias the declaration never authorised.
 */
import { z } from 'zod'
import { type Config, knowledgeBaseAliases } from '../config/index.js'

/**
 * The knowledge-base selector, required on every tool.
 *
 * Declared as an enum over the aliases resolved at startup, so the wire schema
 * both advertises which bases exist and refuses an undeclared alias during
 * argument validation — before any handler, and therefore any filesystem call,
 * runs. There is deliberately no default: omitting `kb` is a validation error,
 * never a silent choice of base.
 */
export const kbArg = (cfg: Config) =>
  z
    .enum(knowledgeBaseAliases(cfg) as [string, ...string[]])
    .describe(
      'Alias of the knowledge base to act in. Required — there is no default base. Call kb_config to list every declared alias.'
    )
