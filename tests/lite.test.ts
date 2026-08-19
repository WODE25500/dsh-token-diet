import { describe, expect, it } from 'vitest'
import { liteSavingsCounter } from '../src/lite.js'
import { dietText, dietJson, dietCsv } from '../src/index.js'
import { computeSaved } from '../src/diet-feedback.js'

describe('lite entry', () => {
  it('exposes a working standalone counter', () => {
    expect(liteSavingsCounter.snapshot()).toMatchObject({ calls: 0, savedTotal: 0 })
  })

  it('core diet functions work for all three actions', () => {
    const text = dietText({ text: 'hello world this is a test' })
    expect(text.truncated).toBe(false)

    const json = dietJson({ json: JSON.stringify({ a: [1, 2, 3], b: 'x' }) })
    expect(json.rootType).toBe('object')

    const csv = dietCsv({ csv: 'a,b\n1,2\n3,4' })
    expect(csv.rowCount).toBe(2)
  })

  it('lite-style single-action flow reports savings', () => {
    const bigText = 'line of log data '.repeat(1000)
    const result = dietText({ text: bigText })
    const out = JSON.stringify(result)
    const saved = computeSaved(result.tokens, out)
    expect(saved.savedPercent).toBeGreaterThan(0)
    expect(saved.savedTokens).toBeGreaterThan(0)
  })
})
