/**
 * dsh-token-diet 轻量版入口（lite）。
 *
 * 与完整版（src/index.ts）的区别：
 * - 只注册 1 个 `diet` 工具（action 参数区分 text/json/csv）+ `diet_stats`；
 * - 不依赖 settings 服务：压缩参数用内置 balanced 档默认值，工具可显式覆盖；
 * - 面向"少即是省"的场景：更少的工具 schema = 更少的上下文占用。
 *
 * 每次调用同样附带 `saved` 反馈（原始 token → 瘦身后 token → 节约量与百分比）。
 *
 * 接入方式：
 *   - id: tool-token-diet-lite
 *     name: 'dsh-token-diet/lite'
 *
 * 安全边界：纯函数、零依赖；输入上限 512KB；不读文件/不联网/不 eval。
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { dietText, estimateTokens, MAX_INPUT_CHARS } from './diet-text.js'
import { dietJson } from './diet-json.js'
import { dietCsv } from './diet-csv.js'
import { computeSaved, SavingsCounter } from './diet-feedback.js'

export const name = 'dsh-token-diet/lite'
export const inject = ['tools']

/** lite 版独立计数器（与完整版分开统计）。 */
export const liteSavingsCounter = new SavingsCounter()

export function apply(ctx: Context): void {
  ctx.tools.register(
    defineTool({
      name: 'diet',
      description:
        'Slim down large content before it enters context (action: text | json | csv). ' +
        'Returns a structure-preserving summary plus saved-token feedback (original → output → saved %). ' +
        'Use when a file, log, API response, or data table is too big to read fully.',
      parameters: {
        action: {
          type: 'string',
          required: true,
          enum: ['text', 'json', 'csv'],
          description: 'Content kind: text = plain text/log; json = JSON document; csv = CSV/TSV table.',
        },
        content: {
          type: 'string',
          required: true,
          description: 'The content to summarize (up to 512KB).',
        },
        limit: {
          type: 'integer',
          description: 'Budget override: for text = head chars; for json = max keys; for csv = sample rows.',
        },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      execute: async (args) => {
        const action = args.action
        const content = args.content
        if (typeof content !== 'string') throw new Error('diet: content 必须是字符串')
        if (typeof action !== 'string') throw new Error('diet: action 必须是 text/json/csv')

        if (action === 'text') {
          const result = dietText({ text: content, headChars: args.limit })
          const out = JSON.stringify(result)
          const saved = computeSaved(result.tokens, out)
          liteSavingsCounter.record(saved)
          return JSON.stringify({ ...result, saved })
        }
        if (action === 'json') {
          const result = dietJson({ json: content, maxKeys: args.limit })
          const out = JSON.stringify(result)
          const saved = computeSaved(result.tokens, out)
          liteSavingsCounter.record(saved)
          return JSON.stringify({ ...result, saved })
        }
        if (action === 'csv') {
          const result = dietCsv({ csv: content, maxSampleRows: args.limit })
          const out = JSON.stringify(result)
          const saved = computeSaved(result.tokens, out)
          liteSavingsCounter.record(saved)
          return JSON.stringify({ ...result, saved })
        }
        throw new Error(`diet: 未知 action: ${action}`)
      },
      timeoutMs: 3000,
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'diet_stats',
      description:
        'Show cumulative token savings of this process (lite): calls, original tokens, output tokens, ' +
        'and total saved (absolute + percent). Call to report how much context the session saved.',
      parameters: {},
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      execute: async () => JSON.stringify(liteSavingsCounter.snapshot()),
      timeoutMs: 2000,
    }),
  )
}
