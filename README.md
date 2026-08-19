# dsh-token-diet

DeepSeek Harness 的**省 token 工具集** —— 纯函数瘦身工具，让模型在把大内容塞进上下文**之前**先做"结构保留摘要"，从源头省 token。零依赖。**压缩比例可配置**（三档预设 + 逐项覆盖）+ **真实节约反馈**（每次调用返回省了多少 token）。

> **和现有方案的区别**：官方 `dsh-compaction-tool-result-pruner` 是**事后**裁剪（compaction 触发时才修剪历史结果）；`dsh-context` / `dsh-budget` 是**监控**；本插件是**事前主动瘦身**——信息骨架完整保留，token 消耗小一个量级，且不丢关键结构。

## 两个版本

| 版本 | 入口 | 工具 | 特点 |
| --- | --- | --- | --- |
| **完整版**（默认） | `dsh-token-diet` | `diet_text` / `diet_json` / `diet_csv` / `diet_estimate` / `diet_stats` | settings 三档预设 + 逐项覆盖 |
| **lite 版** | `dsh-token-diet/lite` | `diet`（action: text/json/csv）+ `diet_stats` | 单工具、无 settings 依赖、schema 更省 |

```yaml
# 完整版
plugins:
  - id: tool-token-diet
    name: 'dsh-token-diet'
# lite 版
plugins:
  - id: tool-token-diet-lite
    name: 'dsh-token-diet/lite'
```

## 注册工具（完整版）

| 工具 | 功能 | 典型场景 |
| --- | --- | --- |
| `diet_text` | 大文本 → 头/尾 + 行数 + 高频关键词 + token 估算 | 日志、文档、爬取正文 |
| `diet_json` | 大 JSON → key 骨架 + 类型/键数/数组长度 + 抽样值 | API 响应、配置文件 |
| `diet_csv` | 大 CSV → 列类型/distinct/min/max/avg + 抽样行 | 数据文件、报表导出 |
| `diet_estimate` | 任意文本 → token 估算 + 进上下文建议 | 决定"读全文 / 瘦身 / 跳过" |
| `diet_stats` | 本次进程累计节约统计（跨调用汇总） | 汇报会话总共省了多少 |

## 节约反馈（每次调用都看得到）

每个瘦身工具（`diet_text/json/csv`）的返回结果都会附带 `saved` 字段，让用户**真实看到省了多少**：

```json
{
  "kind": "csv",
  "rowCount": 8000,
  "colStats": [...],
  "saved": {
    "originalTokens": 38563,
    "outputTokens": 196,
    "savedTokens": 38367,
    "savedPercent": 99.5
  }
}
```

- `originalTokens`：原始内容的估算 token 数
- `outputTokens`：瘦身结果的估算 token 数（含反馈字段）
- `savedTokens` / `savedPercent`：本次调用节约量（绝对值 + 百分比）

调用 `diet_stats` 可查看累计：`{"calls":3,"originalTotal":110272,"outputTotal":1102,"savedTotal":109170,"savedPercent":99}`

> 实测：45,400 token 的日志 → 705 token（省 98.4%）；38,563 token 的 CSV → 196 token（省 99.5%）；26,309 token 的 JSON → 201 token（省 99.2%）。token 数为估算值（CJK ≈1.1 token/字，Latin ≈0.25 token/字符），用于决策与汇报足够准确。

## 压缩比例配置（settings）

插件注册 settings 命名空间 `token-diet`，在 Web UI 设置面板或 settings 文件中调整：

### 三档预设（`preset`，一键切换）

| 档位 | 适用场景 | headChars | maxKeys | maxSample | 压缩强度 |
| --- | --- | --- | --- | --- | --- |
| `light` | 需要细节的任务（代码评审、精确引用） | 2000 | 25 | 6 | 轻 |
| `balanced`（默认） | 大多数任务，骨架完整且 token 明显减少 | 800 | 12 | 3 | 中 |
| `aggressive` | 极端省 token（长会话、批量处理） | 300 | 6 | 2 | 强 |

### 手动压缩比例（`compression: 0-99`，不用档位直接指定省多少）

在 settings 中设 `compression`，或每次调用时传 `compression` 参数，直接指定压缩强度：

| 值 | 行为 |
| --- | --- |
| `0` | **不压缩**：返回原文基线（`mode: "raw"`），saved=0 —— 用于对比"不压缩是多少 token" |
| `1` | 最保留：headChars 4000 / maxKeys 50（≈档位 light 之上） |
| `50` | 中等：headChars 2050 / maxKeys 27 |
| `99` | 极致：headChars 100 / maxKeys 3（≈档位 aggressive 之下） |

8 个参数在区间内线性插值（`headChars 100-4000`、`maxKeys 3-50`、`maxSampleRows 1-20`…），
settings 中已显式覆盖的参数不被比例覆盖。

```yaml
# settings 文件示例
token-diet:
  compression: 80        # 全局手动压缩 80%（覆盖档位）
  headChars: 500         # 但文本头部固定 500（显式覆盖 > 比例）
```

或调用时指定：`diet_text(text, compression: 90)`

实测（同一份 8.2 万字符日志）：

```
compression=10% → headChars=3642 → 省 96.0%
compression=50% → headChars=2050 → 省 97.7%
compression=90% → headChars=458  → 省 99.4%
compression=99% → headChars=100  → 省 99.8%
```

### 优先级链

```
工具显式参数 > 工具 compression > settings compression > settings 逐项覆盖 > 档位默认值
```

即：模型调用 `diet_csv(csv, compression: 90, maxSampleRows: 10)` 时，10 优先于压缩比例；压缩比例优先于 settings 档位。

## 省多少？

示例：10 万字符的 CSV（约 2.5 万 token）
- 直接进上下文：~25,000 token
- `diet_csv` 后：列统计（3 列）+ 5 行抽样 ≈ **150 token**（省 99%）

示例：500KB 的 JSON API 响应
- 直接进上下文：~125,000 token（很可能直接爆上下文）
- `diet_json` 后：结构骨架 + 抽样 ≈ **300 token**，且模型能按 key 路径精确取值

## 安全模型

- **纯函数**：不读文件、不联网、不 eval；
- **输入上限** 512KB，超限直接报错不截断处理；
- **输出紧凑**：全部返回结构化 JSON 字符串；
- **Unicode 安全**：按码点截断，不切开代理对（emoji/生僻字不乱码）。

## 安装

```yaml
# cordis.yml / dsh.profile 引用
plugins:
  - id: tool-token-diet
    name: 'dsh-token-diet'
```

或本地路径方式：

```yaml
plugins:
  ./src/index.ts: {}
```

## 使用示例

```
diet_estimate text: "<大文件内容>" → {"chars":102400,"tokens":25600,"verdict":"必须瘦身"}
diet_csv csv: "<CSV内容>" → 列统计 + 5 行抽样 + 建议
diet_json json: "<JSON内容>" → 结构骨架 + 抽样
diet_text text: "<日志内容>" → 头 800 字 + 尾 300 字 + 高频词
```

## 开发

```sh
npm install
npm run check   # typecheck + test + build
```

- Node 要求：`^22.19.0 || >=24.0.0`。
- 核心逻辑在 `src/diet-*.ts`（纯函数、可单测），插件入口在 `src/index.ts`。
- 测试覆盖：RFC 4180 引号解析、列统计、JSON 结构摘要、Unicode 截断、超大输入拒绝。

## 许可

MIT
