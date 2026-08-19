/**
 * diet_csv：大 CSV → 列统计（类型/distinct/min/max/avg/空值率）+ 抽样行。
 * 目的：模型不用把整张表打进去，先看列分布再决定怎么查。
 * RFC 4180 子集：支持引号字段、"" 转义、逗号/换行在引号内、BOM 忽略。
 */

import { checkInput, estimateTokens } from './diet-text.js'

export interface DietCsvArgs {
  csv: unknown
  delimiter?: unknown
  maxSampleRows?: unknown
  maxColStats?: unknown
}

export interface ColumnStat {
  name: string
  type: string
  nonNull: number
  distinct: number
  min: string | null
  max: string | null
  avg: number | null
}

export interface DietCsvResult {
  kind: 'csv'
  columns: string[]
  rowCount: number
  colStats: ColumnStat[]
  sampleRows: string[][]
  totalChars: number
  tokens: number
  truncated: boolean
  hint: string
}

/** RFC 4180 状态机解析（单遍扫描）。返回行数组（每行是字符串数组）。 */
export function parseCsv(text: string, delimiter = ','): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  // 跳过 BOM
  if (text.charCodeAt(0) === 0xfeff) i = 1
  const delim = delimiter === 'tab' ? '\t' : delimiter

  while (i < text.length) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += c
      i++
      continue
    }
    if (c === '"' && field === '') {
      inQuotes = true
      i++
      continue
    }
    if (c === delim) {
      row.push(field)
      field = ''
      i++
      continue
    }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      rows.push(row)
      row = []
      i++
      continue
    }
    field += c
    i++
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

function inferType(v: string): string {
  if (v === '') return 'empty'
  if (/^-?\d+$/.test(v)) return 'int'
  if (/^-?\d+\.\d+$/.test(v)) return 'float'
  if (/^(true|false)$/i.test(v)) return 'bool'
  return 'string'
}

/** 大 CSV → 列统计 + 抽样行。
 * 优先级：args 显式参数 > base（settings 档位/覆盖）> 函数内默认值。 */
export function dietCsv(
  args: DietCsvArgs,
  base: Partial<Pick<DietCsvArgs, 'maxSampleRows' | 'maxColStats'>> = {},
): DietCsvResult {
  const raw = checkInput(args.csv, 'csv')
  const delimiter = typeof args.delimiter === 'string' ? args.delimiter : ','
  const maxSampleRows = typeof args.maxSampleRows === 'number'
    ? Math.max(1, Math.min(args.maxSampleRows, 20))
    : typeof base.maxSampleRows === 'number'
      ? Math.max(1, Math.min(base.maxSampleRows, 20))
      : 5
  const maxColStats = typeof args.maxColStats === 'number'
    ? Math.max(1, Math.min(args.maxColStats, 30))
    : typeof base.maxColStats === 'number'
      ? Math.max(1, Math.min(base.maxColStats, 30))
      : 20

  const rows = parseCsv(raw, delimiter)
  if (rows.length === 0) {
    return {
      kind: 'csv', columns: [], rowCount: 0, colStats: [], sampleRows: [],
      totalChars: raw.length, tokens: 0, truncated: false,
      hint: 'CSV 为空。',
    }
  }

  const header = rows[0] ?? []
  const data = rows.slice(1)
  const columns = header.map((h, idx) => h.trim() || `col${idx + 1}`)

  const colStats: ColumnStat[] = columns.slice(0, maxColStats).map((name, ci) => {
    const values = data.map((r) => r[ci] ?? '')
    const nonEmpty = values.filter((v) => v !== '')
    const types = new Set(nonEmpty.map(inferType))
    const distinct = new Set(values).size
    const nums = nonEmpty.map(Number).filter((n) => Number.isFinite(n))
    const type = nonEmpty.length === 0
      ? 'empty'
      : types.size === 1
        ? (types.values().next().value as string)
        : 'mixed'
    const min = nonEmpty.length ? nonEmpty.reduce((a, b) => (a < b ? a : b)) : null
    const max = nonEmpty.length ? nonEmpty.reduce((a, b) => (a > b ? a : b)) : null
    const avg = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null
    return {
      name,
      type,
      nonNull: nonEmpty.length,
      distinct,
      min,
      max,
      avg: avg === null ? null : Math.round(avg * 100) / 100,
    }
  })

  const sampleRows = data.slice(0, maxSampleRows)
  const rowCount = data.length
  const truncated = rowCount > maxSampleRows
  const tokens = estimateTokens(raw)

  return {
    kind: 'csv',
    columns,
    rowCount,
    colStats,
    sampleRows,
    totalChars: raw.length,
    tokens,
    truncated,
    hint: truncated
      ? `CSV 共 ${rowCount} 行数据（约 ${tokens} token）。已给 ${maxSampleRows} 行抽样 + ${colStats.length} 列统计。` +
        `需要更多行或做过滤聚合时，用 sqlite 工具或让模型按列条件取子集。`
      : `CSV ${rowCount} 行 / ${columns.length} 列，约 ${tokens} token，数据完整。`,
  }
}
