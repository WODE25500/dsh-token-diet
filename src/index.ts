/**
 * dsh-token-diet 插件入口。
 *
 * 注册 4 个"事前主动瘦身"工具：模型在把大内容塞进上下文之前先调用，
 * 得到结构保留摘要，从源头省 token：
 *   - diet_text     大文本 → 头/尾 + 行数 + 高频词
 *   - diet_json     大 JSON → key 骨架 + 类型/键数统计 + 抽样
 *   - diet_csv      大 CSV → 列类型/distinct/min/max/avg + 抽样行
 *   - diet_estimate 任意文本 → token 估算（决定要不要全文进上下文）
 *
 * 接入方式：在 cordis.yml 追加：
 *   - id: tool-token-diet
 *     name: 'dsh-token-diet'
 *
 * 安全边界：纯函数、零依赖；输入上限 512KB；不读文件/不联网/不 eval。
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { dietText, estimateTokens, MAX_INPUT_CHARS } from './diet-text.js'
import { dietJson } from './diet-json.js'
import { dietCsv } from './diet-csv.js'

export {
  dietText,
  estimateTokens,
  checkInput,
  sliceByCodepoints,
  extractKeywords,
  MAX_INPUT_CHARS,
} from './diet-text.js'
export { dietJson } from './diet-json.js'
export { dietCsv, parseCsv } from './diet-csv.js'

export const name = 'dsh-token-diet'
export const inject = ['tools']

export function apply(ctx: Context): void {
  ctx.tools.register(
    defineTool({
      name: 'diet_text',
      description:
        'Slim down a large text before putting it into context: returns head + tail + line count + ' +
        'high-frequency keywords + token estimate, instead of the full text. Use when a file or log is ' +
        'too big to read fully — inspect the skeleton first, then read only the relevant parts.',
      parameters: {
        text: {
          type: 'string',
          required: true,
          description: 'The text content to summarize (up to 512KB).',
        },
        headChars: {
          type: 'integer',
          description: 'Leading chars to keep (default 800, max 4000).',
        },
        tailChars: {
          type: 'integer',
          description: 'Trailing chars to keep (default 300, max 2000).',
        },
        maxKeywords: {
          type: 'integer',
          description: 'Max high-frequency keywords (default 10, max 30).',
        },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      execute: async (args) => JSON.stringify(dietText(args)),
      timeoutMs: 3000,
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'diet_json',
      description:
        'Slim down a large JSON document: returns the key skeleton with types, key counts, ' +
        'array lengths, and sampled values — not the full payload. Use before putting a big API ' +
        'response or config into context; then fetch specific fields by path.',
      parameters: {
        json: {
          type: 'string',
          required: true,
          description: 'The JSON text to summarize (up to 512KB).',
        },
        maxKeys: {
          type: 'integer',
          description: 'Max keys shown per object (default 12, max 50).',
        },
        maxSample: {
          type: 'integer',
          description: 'Max array samples shown (default 3, max 10).',
        },
        maxDepth: {
          type: 'integer',
          description: 'Max nesting depth summarized (default 4, max 8).',
        },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      execute: async (args) => JSON.stringify(dietJson(args)),
      timeoutMs: 3000,
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'diet_csv',
      description:
        'Slim down a large CSV/TSV table: returns per-column stats (type, non-null count, distinct, ' +
        'min/max/avg) plus a few sample rows — not the whole table. Use before loading a big data ' +
        'file into context; then query subsets with the sqlite tool if available.',
      parameters: {
        csv: {
          type: 'string',
          required: true,
          description: 'The CSV text to summarize (RFC 4180; up to 512KB).',
        },
        delimiter: {
          type: 'string',
          description: 'Column delimiter: "," (default), ";" or "tab".',
        },
        maxSampleRows: {
          type: 'integer',
          description: 'Sample rows to show (default 5, max 20).',
        },
        maxColStats: {
          type: 'integer',
          description: 'Columns with full stats (default 20, max 30).',
        },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      execute: async (args) => JSON.stringify(dietCsv(args)),
      timeoutMs: 3000,
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'diet_estimate',
      description:
        'Estimate the token cost of any text before deciding whether to put it into context. ' +
        'Returns char count, approximate tokens (CJK ≈1.1 token/char, Latin ≈0.25 token/char), and a ' +
        'suggestion. Use to decide: read fully / diet it / skip.',
      parameters: {
        text: {
          type: 'string',
          required: true,
          description: 'Text to estimate (up to 512KB).',
        },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      execute: async (args) => {
        if (typeof args.text !== 'string') throw new Error('diet: text 必须是字符串')
        if (args.text.length > MAX_INPUT_CHARS) {
          throw new Error(`diet: text 超过 ${MAX_INPUT_CHARS} 字符上限`)
        }
        const tokens = estimateTokens(args.text)
        const chars = Array.from(args.text).length
        const verdict = tokens < 500 ? '可直接全文进上下文' : tokens < 3000 ? '建议先用 diet_text/diet_json/diet_csv 瘦身' : '必须瘦身，否则将占用大量上下文'
        return JSON.stringify({ chars, tokens, verdict })
      },
      timeoutMs: 2000,
    }),
  )
}
