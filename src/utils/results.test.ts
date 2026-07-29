import { describe, expect, it } from 'vitest'
import { errorResult, jsonResult } from './results.js'

describe('errorResult', () => {
  it('builds the MCP error response shape, prefixing the action', () => {
    expect(errorResult('reading note', new Error('something went wrong'))).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'Error reading note: something went wrong' }]
    })
  })

  it('coerces non-Error values via errMessage', () => {
    expect(errorResult('writing note', 'plain string')).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'Error writing note: plain string' }]
    })
  })
})

describe('jsonResult', () => {
  it('serialises a payload to pretty JSON in a text block', () => {
    const result = jsonResult({ a: 1, b: 'two' })
    expect(result.content[0]?.type).toBe('text')
    expect(JSON.parse(result.content[0]?.text ?? '')).toEqual({ a: 1, b: 'two' })
  })

  it('sets structuredContent to the same payload the text block carries', () => {
    const payload = { path: 'Pillars/Note.md', count: 2, entries: ['a', 'b'] }
    const result = jsonResult(payload)
    expect(result.structuredContent).toEqual(payload)
    expect(JSON.parse(result.content[0]?.text ?? '')).toEqual(result.structuredContent)
  })
})
