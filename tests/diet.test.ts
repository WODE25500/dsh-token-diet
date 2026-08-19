import { describe, expect, it } from 'vitest'
import {
  dietText,
  dietJson,
  dietCsv,
  estimateTokens,
  sliceByCodepoints,
  extractKeywords,
  checkInput,
  parseCsv,
} from '../src/index.js'
import { PRESETS, resolveDietOptions, mergeToolArgs, DEFAULT_SETTINGS, applyCompression, clampCompression, COMPRESSION_RANGES } from '../src/config.js'
import { computeSaved, formatSaved, SavingsCounter } from '../src/diet-feedback.js'

describe('diet-text', () => {
  it('summarizes small text without truncation', () => {
    const r = dietText({ text: 'hello world this is a test' })
    expect(r.truncated).toBe(false)
    expect(r.tokens).toBeGreaterThan(0)
    expect(r.lines).toBe(1)
  })

  it('truncates large text with head+tail', () => {
    const big = '甲'.repeat(3000)
    const r = dietText({ text: big })
    expect(r.truncated).toBe(true)
    expect(Array.from(r.head).length).toBe(800)
    expect(Array.from(r.tail).length).toBe(300)
  })

  it('extracts CJK keywords and skips stopwords', () => {
    const r = dietText({ text: '茶叶 审评 审评 审评 冲泡 水温 茶叶' })
    expect(r.keywords).toContain('审评')
    expect(r.keywords).toContain('茶叶')
  })

  it('rejects oversized input', () => {
    expect(() => checkInput('x'.repeat(600_000), 'text')).toThrow(/上限/)
  })

  it('slices without breaking surrogate pairs', () => {
    const s = '😀😀😀😀😀'
    expect(sliceByCodepoints(s, 0, 2)).toBe('😀😀')
  })

  it('estimates tokens (CJK heavier than latin)', () => {
    expect(estimateTokens('中文中文')).toBeGreaterThan(estimateTokens('abcd'))
  })
})

describe('diet-json', () => {
  it('summarizes nested JSON structure', () => {
    const r = dietJson({
      json: JSON.stringify({ users: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }], total: 2, ok: true }),
    })
    expect(r.rootType).toBe('object')
    expect(r.totalKeys).toBeGreaterThanOrEqual(4)
    const stats = JSON.stringify(r.stats)
    expect(stats).toContain('users')
    expect(stats).toContain('array')
  })

  it('rejects invalid JSON', () => {
    expect(() => dietJson({ json: '{not json' })).toThrow(/解析失败/)
  })

  it('caps array samples and flags truncation', () => {
    const big = JSON.stringify({ items: Array.from({ length: 100 }, (_, i) => ({ i })) })
    const r = dietJson({ json: big, maxSample: 2 })
    expect(r.truncated).toBe(true)
    const original = JSON.stringify({ items: Array.from({ length: 100 }, (_, i) => ({ i })) })
    expect(JSON.stringify(r.stats).length).toBeLessThan(original.length)
  })
})

describe('diet-csv', () => {
  it('parses RFC 4180 with quotes, commas and escaped quotes', () => {
    const rows = parseCsv('a,b\n"x,1","he said ""hi"""\n1,2')
    expect(rows).toEqual([
      ['a', 'b'],
      ['x,1', 'he said "hi"'],
      ['1', '2'],
    ])
  })

  it('computes column stats', () => {
    const r = dietCsv({ csv: 'name,age\nAlice,30\nBob,25\nCarol,35' })
    expect(r.columns).toEqual(['name', 'age'])
    expect(r.rowCount).toBe(3)
    const age = r.colStats.find((c) => c.name === 'age')!
    expect(age.type).toBe('int')
    expect(age.min).toBe('25')
    expect(age.max).toBe('35')
    expect(age.avg).toBe(30)
  })

  it('handles TSV and mixed types', () => {
    const r = dietCsv({ csv: 'k\tv\n1\ttrue\n2\tfalse\n3\tx', delimiter: 'tab' })
    const v = r.colStats.find((c) => c.name === 'v')!
    expect(v.type).toBe('mixed')
  })

  it('truncates sample rows for big tables', () => {
    const csv = 'n\n' + Array.from({ length: 50 }, (_, i) => i).join('\n')
    const r = dietCsv({ csv, maxSampleRows: 3 })
    expect(r.truncated).toBe(true)
    expect(r.sampleRows.length).toBe(3)
  })
})

describe('exports', () => {
  it('exposes core functions from index', () => {
    expect(typeof dietText).toBe('function')
    expect(typeof dietJson).toBe('function')
    expect(typeof dietCsv).toBe('function')
    expect(typeof estimateTokens).toBe('function')
    expect(typeof extractKeywords).toBe('function')
  })
})

describe('config presets', () => {
  it('has three distinct presets with different compression', () => {
    const light = resolveDietOptions({ preset: 'light' })
    const balanced = resolveDietOptions({ preset: 'balanced' })
    const aggressive = resolveDietOptions({ preset: 'aggressive' })
    expect(light.headChars).toBeGreaterThan(balanced.headChars)
    expect(balanced.headChars).toBeGreaterThan(aggressive.headChars)
    expect(light.maxSample).toBeGreaterThan(aggressive.maxSample)
    expect(aggressive.maxSampleRows).toBeLessThan(light.maxSampleRows)
  })

  it('defaults to balanced preset', () => {
    const opts = resolveDietOptions(DEFAULT_SETTINGS)
    expect(opts.headChars).toBe(PRESETS.balanced.headChars)
  })

  it('settings overrides beat preset defaults', () => {
    const opts = resolveDietOptions({ preset: 'aggressive', headChars: 1500 })
    expect(opts.headChars).toBe(1500)
    expect(opts.tailChars).toBe(PRESETS.aggressive.tailChars)
  })

  it('mergeToolArgs applies explicit tool args last', () => {
    const opts = resolveDietOptions({ preset: 'balanced' })
    const merged = mergeToolArgs(opts, { headChars: 42 }, ['headChars'])
    expect(merged.headChars).toBe(42)
    expect(merged.tailChars).toBe(opts.tailChars)
  })

  it('preset difference changes actual diet_text output', () => {
    const big = '字'.repeat(2000)
    const light = dietText({ text: big }, resolveDietOptions({ preset: 'light' }))
    const aggressive = dietText({ text: big }, resolveDietOptions({ preset: 'aggressive' }))
    expect(Array.from(light.head).length).toBeGreaterThan(Array.from(aggressive.head).length)
  })
})

describe('manual compression ratio (0-99)', () => {
  it('clamps out-of-range values', () => {
    expect(clampCompression(-5)).toBe(0)
    expect(clampCompression(150)).toBe(99)
    expect(clampCompression(42.6)).toBe(43)
  })

  it('higher compression keeps less content', () => {
    const base = resolveDietOptions({ preset: 'balanced' })
    const mild = applyCompression(10, { preset: 'balanced' }, base)
    const max = applyCompression(99, { preset: 'balanced' }, base)
    expect(mild.headChars).toBeGreaterThan(max.headChars)
    expect(mild.maxSample).toBeGreaterThanOrEqual(max.maxSample)
    expect(max.headChars).toBe(COMPRESSION_RANGES.headChars.min)
  })

  it('compression=1 keeps near-maximum content', () => {
    const base = resolveDietOptions({ preset: 'balanced' })
    const gentle = applyCompression(1, { preset: 'balanced' }, base)
    expect(gentle.headChars).toBe(COMPRESSION_RANGES.headChars.max)
  })

  it('settings explicit overrides beat compression interpolation', () => {
    // settings.headChars 显式 500 → resolve 后为 500，compression 不覆盖它
    const settings = { preset: 'balanced' as const, headChars: 500 }
    const base = resolveDietOptions(settings)
    expect(base.headChars).toBe(500)
    const opts = applyCompression(99, settings, base)
    expect(opts.headChars).toBe(500)
    // 未覆盖的字段被插值
    expect(opts.tailChars).toBe(COMPRESSION_RANGES.tailChars.min)
  })

  it('compression interpolates linearly mid-range', () => {
    const base = resolveDietOptions({ preset: 'balanced' })
    const half = applyCompression(50, { preset: 'balanced' }, base)
    const r = COMPRESSION_RANGES.headChars
    const expected = Math.round(r.max - ((r.max - r.min) * (50 - 1)) / 98)
    expect(half.headChars).toBe(expected)
  })
})

describe('saved-token feedback', () => {
  it('computeSaved reports positive savings for big inputs', () => {
    const bigText = Array.from({ length: 5000 }, (_, i) => `line ${i} some log content here`).join('\n')
    const result = dietText({ text: bigText })
    const out = JSON.stringify(result)
    const saved = computeSaved(result.tokens, out)
    expect(saved.originalTokens).toBe(result.tokens)
    expect(saved.outputTokens).toBeLessThan(saved.originalTokens)
    expect(saved.savedTokens).toBeGreaterThan(0)
    expect(saved.savedPercent).toBeGreaterThan(0)
    expect(saved.savedPercent).toBeLessThanOrEqual(100)
  })

  it('formatSaved renders a human-readable line', () => {
    const s = computeSaved(10000, '{"a":1}')
    const line = formatSaved(s)
    expect(line).toContain('token')
    expect(line).toContain('%')
  })

  it('SavingsCounter accumulates across calls', () => {
    const c = new SavingsCounter()
    c.record({ originalTokens: 1000, outputTokens: 100, savedTokens: 900, savedPercent: 90 })
    c.record({ originalTokens: 2000, outputTokens: 200, savedTokens: 1800, savedPercent: 90 })
    const snap = c.snapshot()
    expect(snap.calls).toBe(2)
    expect(snap.originalTotal).toBe(3000)
    expect(snap.outputTotal).toBe(300)
    expect(snap.savedTotal).toBe(2700)
    expect(snap.savedPercent).toBe(90)
  })

  it('savedPercent never exceeds 100 even with tiny outputs', () => {
    const s = computeSaved(10, 'x')
    expect(s.savedPercent).toBeLessThanOrEqual(100)
    expect(s.savedTokens).toBeGreaterThanOrEqual(0)
  })
})
