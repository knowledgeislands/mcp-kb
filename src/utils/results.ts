/**
 * MCP result-envelope helpers.
 *
 * These belong to the thin `tools/` layer only: `main/` returns plain data (or
 * throws), and the tool handler maps that to an envelope here. Keeping the
 * helpers out of `main/` is what stops implementation code from knowing about
 * the MCP wire format.
 *
 * `jsonResult` sets `structuredContent` **and** serialises the same payload
 * into a text content block, so older clients that ignore `structuredContent`
 * still see the JSON. Every tool that calls it must declare a matching
 * `outputSchema` on registration (MCP spec 2025-11-25, §12 of the house
 * standard).
 */
import { errMessage } from './utils.js'

export const errorResult = (action: string, error: unknown) => {
  return {
    isError: true as const,
    content: [{ type: 'text' as const, text: `Error ${action}: ${errMessage(error)}` }]
  }
}

export const jsonResult = (payload: unknown) => {
  return {
    structuredContent: payload as Record<string, unknown>,
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }]
  }
}
