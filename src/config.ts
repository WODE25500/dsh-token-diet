/**
 * dsh-token-diet 配置模块：三档压缩预设 + 精细覆盖。
 *
 * 档位决定每个工具参数的默认值；settings 面板可切换档位或逐项覆盖；
 * 工具调用时显式传参优先级最高。
 *
 * 优先级链：工具显式参数 > settings 精细覆盖 > 档位默认值
 */

export type DietPreset = 'light' | 'balanced' | 'aggressive'

export interface DietSettings {
  preset: DietPreset
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
export const PRESETS: Record<DietPreset, Required<Omit<DietSettings, 'preset'>>> = {
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

/** 把 settings 解析为每个参数的实际值（档位默认 + 精细覆盖）。 */
export function resolveDietOptions(settings: DietSettings): Required<Omit<DietSettings, 'preset'>> {
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

/** 工具显式参数覆盖解析后的 options。 */
export function mergeToolArgs<T extends Record<string, unknown>>(
  opts: Required<Omit<DietSettings, 'preset'>>,
  args: T,
  keys: (keyof Required<Omit<DietSettings, 'preset'>>)[],
): Required<Omit<DietSettings, 'preset'>> {
  const out: Required<Omit<DietSettings, 'preset'>> = { ...opts }
  for (const k of keys) {
    const v = args[k as string]
    if (typeof v === 'number' && Number.isFinite(v)) {
      ;(out as Record<string, number>)[k as string] = v
    }
  }
  return out
}
