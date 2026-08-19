/**
 * diet_json：大 JSON → key 骨架 + 类型统计 + 抽样值。
 * 目的：模型不用把整个 JSON 打进去，先看结构再决定取哪些字段。
 */

import { checkInput, MAX_INPUT_CHARS, estimateTokens } from './diet-text.js'

export interface DietJsonArgs {
  json: unknown
  maxKeys?: unknown
  maxSample?: unknown
  maxDepth?: unknown
}

export interface JsonStat {
  kind: string
  size: number | null
  keys: string[] | null
  sample: unknown[] | null
  /** object 分支的嵌套字段摘要（仅在有嵌套时出现）。 */
  fields?: Record<string, unknown>
}

export interface DietJsonResult {
  kind: 'json'
  rootType: string
  totalKeys: number
  totalChars: number
  tokens: number
  stats: JsonStat[]
  samplePath: string | null
  truncated: boolean
  hint: string
}

type JsonNode = Record<string, unknown> | unknown[] | string | number | boolean | null

function typeOf(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  return typeof v
}

function summarize(node: JsonNode, maxKeys: number, maxSample: number, depth: number, maxDepth: number): JsonStat {
  const t = typeOf(node)
  if (t === 'array') {
    const arr = node as unknown[]
    const sample = arr.slice(0, maxSample).map((v) => {
      if (v !== null && typeof v === 'object') {
        return depth < maxDepth ? summarize(v as JsonNode, maxKeys, maxSample, depth + 1, maxDepth) : { kind: typeOf(v) }
      }
      return v
    })
    return { kind: 'array', size: arr.length, keys: null, sample }
  }
  if (t === 'object') {
    const obj = node as Record<string, unknown>
    const keys = Object.keys(obj)
    const fields: Record<string, unknown> = {}
    for (const k of keys.slice(0, maxKeys)) {
      const v = obj[k]
      fields[k] =
        v !== null && typeof v === 'object'
          ? depth < maxDepth
            ? summarize(v as JsonNode, maxKeys, maxSample, depth + 1, maxDepth)
            : { kind: typeOf(v) }
          : v
    }
    if (keys.length > maxKeys) fields['...'] = `+${keys.length - maxKeys} more keys`
    return { kind: 'object', size: keys.length, keys, sample: null, fields }
  }
  return { kind: t, size: null, keys: null, sample: null }
}

function countKeys(node: unknown, depth = 0, maxDepth = 6): number {
  if (depth > maxDepth) return 0
  if (Array.isArray(node)) {
    return node.slice(0, 50).reduce((acc, v) => acc + countKeys(v, depth + 1, maxDepth), 0)
  }
  if (node !== null && typeof node === 'object') {
    return Object.keys(node).reduce((acc, k) => acc + 1 + countKeys((node as Record<string, unknown>)[k], depth + 1, maxDepth), 0)
  }
  return 0
}

/** 找出 JSON 中最大的数组长度（用于截断判定）。 */
function maxArraySize(node: unknown, depth = 0, maxDepth = 8): number {
  if (depth > maxDepth) return 0
  if (Array.isArray(node)) {
    const inner = node.slice(0, 50).reduce((acc, v) => Math.max(acc, maxArraySize(v, depth + 1, maxDepth)), 0)
    return Math.max(node.length, inner)
  }
  if (node !== null && typeof node === 'object') {
    return Object.values(node).reduce((acc, v) => Math.max(acc, maxArraySize(v, depth + 1, maxDepth)), 0)
  }
  return 0
}

/** 大 JSON → 结构摘要。 */
export function dietJson(args: DietJsonArgs): DietJsonResult {
  const raw = checkInput(args.json, 'json')
  const maxKeys = typeof args.maxKeys === 'number' ? Math.max(1, Math.min(args.maxKeys, 50)) : 12
  const maxSample = typeof args.maxSample === 'number' ? Math.max(1, Math.min(args.maxSample, 10)) : 3
  const maxDepth = typeof args.maxDepth === 'number' ? Math.max(1, Math.min(args.maxDepth, 8)) : 4

  let node: unknown
  try {
    node = JSON.parse(raw)
  } catch (e) {
    throw new Error(`diet: json 解析失败: ${e instanceof Error ? e.message : String(e)}`)
  }

  const rootType = typeOf(node)
  const totalKeys = countKeys(node)
  const totalChars = raw.length
  const tokens = estimateTokens(raw)
  const stats = summarize(node as JsonNode, maxKeys, maxSample, 0, maxDepth)
  const truncated = totalChars > 20_000 || totalKeys > 200 || maxArraySize(node) > 20

  return {
    kind: 'json',
    rootType,
    totalKeys,
    totalChars,
    tokens,
    stats: [stats],
    samplePath: null,
    truncated,
    hint: truncated
      ? `JSON 较大（${totalChars} 字符 / ${totalKeys} 个键，约 ${tokens} token）。已给出结构骨架与抽样。` +
        `需要具体字段时，用 jq 式路径定位或让模型按 key 路径精确取值。`
      : `JSON ${totalChars} 字符 / ${totalKeys} 个键，约 ${tokens} token，结构完整。`,
  }
}
