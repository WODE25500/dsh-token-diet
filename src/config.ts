/**
 * dsh-token-diet 配置模块：三档压缩预设 + 精细覆盖 + 手动压缩比例（0-99%）。
 *
 * 档位决定每个工具参数的默认值；settings 面板可切换档位或逐项覆盖；
 * 工具调用时显式传参优先级最高。
 *
 * 手动压缩比例（compression, 0-99）：
 *   - 0  = 不压缩：返回原文（基线对比，saved=0）
 *   - 1-99 = 线性插值到 8 个参数（1 最保留，99 最压缩）
 *
 * 优先级链：工具显式参数 > 工具 compression > settings compression
 *           > settings 精细覆盖 > 档位默认值
 */

export type DietPreset = 'light' | 'balanced' | 'aggressive'

export interface DietSettings {
  preset: DietPreset
  /** 手动压缩比例 0-99（可选；0=不压缩返回原文，1-99 插值）。 */
  compression?: number
  // 精细覆盖（可选，覆盖档位默认值）
  headChars?: number
  tailChars?: number
  maxKeywords?: number
  maxKeys?: number
  maxSample?: number
  maxDepth?: number
  maxSampleRows?: number
  maxColStats?: number
}

export const DEFAULT_SETTINGS: DietSettings = { preset: 'balanced' }

/** 三档预设的默认参数。 */
export const PRESETS: Record<DietPreset, Required<Omit<DietSettings, 'preset' | 'compression'>>> = {
  light: {
    // 轻压缩：保留更多内容，适合需要细节的任务
    headChars: 2000,
    tailChars: 800,
    maxKeywords: 15,
    maxKeys: 25,
    maxSample: 6,
    maxDepth: 6,
    maxSampleRows: 10,
    maxColStats: 30,
  },
  balanced: {
    // 均衡：默认档，信息骨架完整且 token 明显减少
    headChars: 800,
    tailChars: 300,
    maxKeywords: 10,
    maxKeys: 12,
    maxSample: 3,
    maxDepth: 4,
    maxSampleRows: 5,
    maxColStats: 20,
  },
  aggressive: {
    // 激进压缩：最大程度省 token，只留最小骨架
    headChars: 300,
    tailChars: 100,
    maxKeywords: 6,
    maxKeys: 6,
    maxSample: 2,
    maxDepth: 3,
    maxSampleRows: 3,
    maxColStats: 10,
  },
}

/** 压缩比例插值的参数区间：min = 99% 时的值，max = 1% 时的值。 */
export const COMPRESSION_RANGES: Record<
  keyof Required<Omit<DietSettings, 'preset' | 'compression'>>,
  { min: number; max: number }
> = {
  headChars: { min: 100, max: 4000 },
  tailChars: { min: 0, max: 2000 },
  maxKeywords: { min: 2, max: 30 },
  maxKeys: { min: 3, max: 50 },
  maxSample: { min: 1, max: 10 },
  maxDepth: { min: 2, max: 8 },
  maxSampleRows: { min: 1, max: 20 },
  maxColStats: { min: 3, max: 30 },
}

type DietParams = Required<Omit<DietSettings, 'preset' | 'compression'>>
export type { DietParams }

/** 把 settings 解析为每个参数的实际值（档位默认 + 精细覆盖）。 */
export function resolveDietOptions(settings: DietSettings): DietParams {
  const preset = PRESETS[settings.preset] ?? PRESETS.balanced
  return {
    headChars: settings.headChars ?? preset.headChars,
    tailChars: settings.tailChars ?? preset.tailChars,
    maxKeywords: settings.maxKeywords ?? preset.maxKeywords,
    maxKeys: settings.maxKeys ?? preset.maxKeys,
    maxSample: settings.maxSample ?? preset.maxSample,
    maxDepth: settings.maxDepth ?? preset.maxDepth,
    maxSampleRows: settings.maxSampleRows ?? preset.maxSampleRows,
    maxColStats: settings.maxColStats ?? preset.maxColStats,
  }
}

/**
 * 按手动压缩比例（1-99）对参数线性插值。
 * settings 中已显式覆盖的字段保持不动（精细覆盖 > 比例）。
 */
export function applyCompression(
  compression: number,
  settings: DietSettings,
  base: DietParams,
): DietParams {
  const p = Math.max(1, Math.min(99, Math.round(compression)))
  const out: DietParams = { ...base }
  const keys = Object.keys(COMPRESSION_RANGES) as (keyof DietParams)[]
  for (const key of keys) {
    // 用户已显式覆盖该字段 → 跳过
    if (settings[key] !== undefined) continue
    const { min, max } = COMPRESSION_RANGES[key]
    // p=1 → max；p=99 → min
    out[key] = Math.round(max - ((max - min) * (p - 1)) / 98)
  }
  return out
}

/** 校验压缩比例是否在 0-99 内。 */
export function clampCompression(v: number): number {
  return Math.max(0, Math.min(99, Math.round(v)))
}

/** 工具显式参数覆盖解析后的 options。 */
export function mergeToolArgs<T extends Record<string, unknown>>(
  opts: DietParams,
  args: T,
  keys: (keyof DietParams)[],
): DietParams {
  const out: DietParams = { ...opts }
  for (const k of keys) {
    const v = args[k as string]
    if (typeof v === 'number' && Number.isFinite(v)) {
      ;(out as Record<string, number>)[k as string] = v
    }
  }
  return out
}
