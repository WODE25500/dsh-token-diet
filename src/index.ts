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
 * 压缩比例可配置（settings 命名空间 `token-diet`）：
 *   - preset: light / balanced / aggressive 三档一键切换
 *   - headChars/tailChars/maxKeywords/maxKeys/maxSample/maxDepth/maxSampleRows/maxColStats
 *     可逐项覆盖档位默认值
 *   优先级：工具调用显式参数 > settings 覆盖 > 档位默认
 *
 * 接入方式：在 cordis.yml 追加：
 *   - id: tool-token-diet
 *     name: 'dsh-token-diet'
 *
 * 安全边界：纯函数、零依赖；输入上限 512KB；不读文件/不联网/不 eval。
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import Schema from '@deepseek-ai/schemastery'
import { dietText, estimateTokens, MAX_INPUT_CHARS } from './diet-text.js'
import { dietJson } from './diet-json.js'
import { dietCsv } from './diet-csv.js'
import {
  DEFAULT_SETTINGS,
  resolveDietOptions,
  type DietSettings,
} from './config.js'

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
export { PRESETS, resolveDietOptions, DEFAULT_SETTINGS, type DietSettings, type DietPreset } from './config.js'

export const name = 'dsh-token-diet'
export const inject = ['tools']

/** settings 命名空间：token-diet */
const NS = settingsNamespace('token-diet')

/** settings schema（三档预设 + 逐项覆盖，全部可选）。 */
const DietSettingsSchema = Schema.object({
  preset: Schema.union([
    Schema.const('light'),
    Schema.const('balanced'),
    Schema.const('aggressive'),
  ]).default('balanced'),
  headChars: Schema.number().min(0).max(4000).description('文本摘要保留头部字符数（覆盖档位）'),
  tailChars: Schema.number().min(0).max(2000).description('文本摘要保留尾部字符数（覆盖档位）'),
  maxKeywords: Schema.number().min(1).max(30).description('文本摘要高频词数量（覆盖档位）'),
  maxKeys: Schema.number().min(1).max(50).description('JSON 摘要每对象最大键数（覆盖档位）'),
  maxSample: Schema.number().min(1).max(10).description('JSON 摘要数组抽样数（覆盖档位）'),
  maxDepth: Schema.number().min(1).max(8).description('JSON 摘要嵌套深度（覆盖档位）'),
  maxSampleRows: Schema.number().min(1).max(20).description('CSV 摘要抽样行数（覆盖档位）'),
  maxColStats: Schema.number().min(1).max(30).description('CSV 摘要统计列数（覆盖档位）'),
})

export function apply(ctx: Context): void {
  // settings 服务（可选）：存在则注册命名空间并读取档位/覆盖
  const getSettings = (): DietSettings => {
    try {
      const scope = ctx.settings?.get(NS)
      if (scope && typeof scope === 'object') return scope as DietSettings
    } catch {
      /* settings 未注册或不可用，回退默认 */
    }
    return DEFAULT_SETTINGS
  }

  let settingsReady = false
  try {
    ctx.inject(['settings'], (settingsCtx) => {
      settingsCtx.settings.register(NS, DietSettingsSchema, { applies: 'live' })
      settingsReady = true
    })
  } catch {
    /* settings 服务不可用，使用默认档位 */
  }

  ctx.tools.register(
    defineTool({
      name: 'diet_text',
      description:
        'Slim down a large text before putting it into context: returns head + tail + line count + ' +
        'high-frequency keywords + token estimate, instead of the full text. Use when a file or log is ' +
        'too big to read fully — inspect the skeleton first, then read only the relevant parts. ' +
        'Compression is configurable in settings (preset: light/balanced/aggressive).',
      parameters: {
        text: {
          type: 'string',
          required: true,
          description: 'The text content to summarize (up to 512KB).',
        },
        headChars: {
          type: 'integer',
          description: 'Leading chars to keep (override; default depends on preset).',
        },
        tailChars: {
          type: 'integer',
          description: 'Trailing chars to keep (override; default depends on preset).',
        },
        maxKeywords: {
          type: 'integer',
          description: 'Max high-frequency keywords (override; default depends on preset).',
        },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      execute: async (args) => {
        const opts = resolveDietOptions(getSettings())
        return JSON.stringify(dietText(args, opts))
      },
      timeoutMs: 3000,
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'diet_json',
      description:
        'Slim down a large JSON document: returns the key skeleton with types, key counts, ' +
        'array lengths, and sampled values — not the full payload. Use before putting a big API ' +
        'response or config into context; then fetch specific fields by path. ' +
        'Compression is configurable in settings (preset: light/balanced/aggressive).',
      parameters: {
        json: {
          type: 'string',
          required: true,
          description: 'The JSON text to summarize (up to 512KB).',
        },
        maxKeys: {
          type: 'integer',
          description: 'Max keys shown per object (override; default depends on preset).',
        },
        maxSample: {
          type: 'integer',
          description: 'Max array samples shown (override; default depends on preset).',
        },
        maxDepth: {
          type: 'integer',
          description: 'Max nesting depth summarized (override; default depends on preset).',
        },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      execute: async (args) => {
        const opts = resolveDietOptions(getSettings())
        return JSON.stringify(dietJson(args, opts))
      },
      timeoutMs: 3000,
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'diet_csv',
      description:
        'Slim down a large CSV/TSV table: returns per-column stats (type, non-null count, distinct, ' +
        'min/max/avg) plus a few sample rows — not the whole table. Use before loading a big data ' +
        'file into context; then query subsets with the sqlite tool if available. ' +
        'Compression is configurable in settings (preset: light/balanced/aggressive).',
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
          description: 'Sample rows to show (override; default depends on preset).',
        },
        maxColStats: {
          type: 'integer',
          description: 'Columns with full stats (override; default depends on preset).',
        },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      execute: async (args) => {
        const opts = resolveDietOptions(getSettings())
        return JSON.stringify(dietCsv(args, opts))
      },
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
