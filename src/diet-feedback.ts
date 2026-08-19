/**
 * dsh-token-diet 节约量反馈模块。
 *
 * 每次瘦身调用后计算"原始 token → 瘦身后 token → 节约量/百分比"，
 * 让用户真实看到（估算值）省了多少。同时提供进程内累计统计
 * （diet_stats 工具读取），跨调用汇总整个会话的节约效果。
 */

import { estimateTokens } from './diet-text.js'

export interface SavedStat {
  /** 原始输入的估算 token 数。 */
  originalTokens: number
  /** 瘦身输出的估算 token 数（含反馈字段本身）。 */
  outputTokens: number
  /** 节约的 token 数 = originalTokens - outputTokens（≥0）。 */
  savedTokens: number
  /** 节约百分比（0-100，保留 1 位小数）。 */
  savedPercent: number
}

/** 按输入字符估算原始 token 数。 */
export function originalTokensOf(inputChars: number): number {
  // 用统一的估算口径：中英混合近似，避免重复解析
  return Math.max(1, Math.round(inputChars / 2.5))
}

/** 计算节约统计。 */
export function computeSaved(originalTokens: number, outputText: string): SavedStat {
  const outputTokens = estimateTokens(outputText)
  const savedTokens = Math.max(0, originalTokens - outputTokens)
  const savedPercent = originalTokens > 0 ? Math.round((savedTokens / originalTokens) * 1000) / 10 : 0
  return { originalTokens, outputTokens, savedTokens, savedPercent }
}

/** 人类可读的节约反馈文本。 */
export function formatSaved(s: SavedStat): string {
  return `\n[节约反馈] 原始约 ${s.originalTokens} token → 瘦身后约 ${s.outputTokens} token，省约 ${s.savedTokens} token（${s.savedPercent}%）`
}

/** 进程内累计统计（diet_stats 工具读取）。 */
export class SavingsCounter {
  private calls = 0
  private originalTotal = 0
  private outputTotal = 0

  /** 记录一次调用，返回累计统计。 */
  record(s: SavedStat): { calls: number; originalTotal: number; outputTotal: number; savedTotal: number; savedPercent: number } {
    this.calls += 1
    this.originalTotal += s.originalTokens
    this.outputTotal += s.outputTokens
    const savedTotal = Math.max(0, this.originalTotal - this.outputTotal)
    const savedPercent = this.originalTotal > 0 ? Math.round((savedTotal / this.originalTotal) * 1000) / 10 : 0
    return {
      calls: this.calls,
      originalTotal: this.originalTotal,
      outputTotal: this.outputTotal,
      savedTotal,
      savedPercent,
    }
  }

  /** 读取当前累计统计。 */
  snapshot() {
    return {
      calls: this.calls,
      originalTotal: this.originalTotal,
      outputTotal: this.outputTotal,
      savedTotal: Math.max(0, this.originalTotal - this.outputTotal),
      savedPercent: this.originalTotal > 0
        ? Math.round((Math.max(0, this.originalTotal - this.outputTotal) / this.originalTotal) * 1000) / 10
        : 0,
    }
  }
}
