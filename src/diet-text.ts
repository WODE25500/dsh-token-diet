/**
 * dsh-token-diet 核心逻辑（纯函数、零依赖、可单测）。
 *
 * 设计理念：**事前主动瘦身**，而不是事后裁剪。
 * 官方 `dsh-compaction-tool-result-pruner` 是 compaction 时才修剪历史结果；
 * 本插件让模型在把大文件 / 大 JSON / 大 CSV 塞进上下文之前，先调一次瘦身工具，
 * 得到"结构保留摘要"——信息骨架完整、token 消耗小一个量级。
 *
 * 共同安全边界：
 * - 输入上限 512KB（超限直接报错，不截断处理）；
 * - 所有输出均为紧凑 JSON 字符串；
 * - 纯函数：不读文件、不联网、不 eval。
 */

export const MAX_INPUT_CHARS = 512_000

/** 检查输入大小，超限抛错。 */
export function checkInput(text: unknown, label = 'text'): string {
  if (typeof text !== 'string') throw new Error(`diet: ${label} 必须是字符串`)
  if (text.length > MAX_INPUT_CHARS) {
    throw new Error(`diet: ${label} 超过 ${MAX_INPUT_CHARS} 字符上限（${text.length}）`)
  }
  return text
}

/** 按 Unicode 码点截断，避免切开代理对。 */
export function sliceByCodepoints(text: string, start: number, end: number): string {
  const chars = Array.from(text)
  return chars.slice(start, Math.min(end, chars.length)).join('')
}

/** 估算 token 数：中文字符≈1 token/字，英文≈4 字符/token（近似，仅供决策参考）。 */
export function estimateTokens(text: string): number {
  const cjk = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length
  const rest = Array.from(text).length - cjk
  return Math.ceil(cjk * 1.1 + rest / 4)
}

export interface DietTextArgs {
  text: unknown
  headChars?: unknown
  tailChars?: unknown
  maxKeywords?: unknown
}

export interface DietTextResult {
  kind: 'text'
  chars: number
  tokens: number
  lines: number
  head: string
  tail: string
  keywords: string[]
  truncated: boolean
  hint: string
}

/** 常见停用词（中英混合，用于关键词提取时排除）。 */
const STOPWORDS = new Set([
  '的', '了', '和', '是', '在', '有', '我', '你', '他', '她', '它', '们', '与', '及', '或',
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'is', 'are', 'was',
  'be', 'by', 'at', 'as', 'it', 'this', 'that', 'from',
])

/** 提取高频词（按词频排序，取前 N 个，排除停用词）。 */
export function extractKeywords(text: string, max: number): string[] {
  const freq = new Map<string, number>()
  const tokens = text.match(/[\u4e00-\u9fff]{2,}|[A-Za-z][A-Za-z0-9_]{2,}/g) || []
  for (const t of tokens) {
    const key = t.toLowerCase()
    if (STOPWORDS.has(key)) continue
    freq.set(key, (freq.get(key) || 0) + 1)
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([w]) => w)
}

/** 大文本 → 结构摘要。
 * 优先级：args 显式参数 > base（settings 档位/覆盖）> 函数内默认值。 */
export function dietText(
  args: DietTextArgs,
  base: Partial<Pick<DietTextArgs, 'headChars' | 'tailChars' | 'maxKeywords'>> = {},
): DietTextResult {
  const text = checkInput(args.text)
  const headChars = typeof args.headChars === 'number'
    ? Math.max(0, Math.min(args.headChars, 4000))
    : typeof base.headChars === 'number'
      ? Math.max(0, Math.min(base.headChars, 4000))
      : 800
  const tailChars = typeof args.tailChars === 'number'
    ? Math.max(0, Math.min(args.tailChars, 2000))
    : typeof base.tailChars === 'number'
      ? Math.max(0, Math.min(base.tailChars, 2000))
      : 300
  const maxKeywords = typeof args.maxKeywords === 'number'
    ? Math.max(1, Math.min(args.maxKeywords, 30))
    : typeof base.maxKeywords === 'number'
      ? Math.max(1, Math.min(base.maxKeywords, 30))
      : 10

  const chars = Array.from(text).length
  const truncated = chars > headChars + tailChars
  const head = sliceByCodepoints(text, 0, headChars)
  const tail = truncated ? sliceByCodepoints(text, chars - tailChars, chars) : ''
  const keywords = extractKeywords(text, maxKeywords)
  const lines = text.split(/\r?\n/).length
  const tokens = estimateTokens(text)

  return {
    kind: 'text',
    chars,
    tokens,
    lines,
    head,
    tail,
    keywords,
    truncated,
    hint: truncated
      ? `已截断（共 ${chars} 字符 / 约 ${tokens} token）：保留头 ${headChars} + 尾 ${tailChars} 字符。` +
        `如需分析全文，可分段读取或先用关键词定位。`
      : `全文 ${chars} 字符 / 约 ${tokens} token，未截断。`,
  }
}
