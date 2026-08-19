# dsh-token-diet

DeepSeek Harness 的**省 token 工具集** —— 4 个纯函数瘦身工具，让模型在把大内容塞进上下文**之前**先做"结构保留摘要"，从源头省 token。零依赖。**压缩比例可配置**：三档预设一键切换 + 逐项参数覆盖。

> **和现有方案的区别**：官方 `dsh-compaction-tool-result-pruner` 是**事后**裁剪（compaction 触发时才修剪历史结果）；`dsh-context` / `dsh-budget` 是**监控**；本插件是**事前主动瘦身**——信息骨架完整保留，token 消耗小一个量级，且不丢关键结构。

## 注册工具

| 工具 | 功能 | 典型场景 |
| --- | --- | --- |
| `diet_text` | 大文本 → 头/尾 + 行数 + 高频关键词 + token 估算 | 日志、文档、爬取正文 |
| `diet_json` | 大 JSON → key 骨架 + 类型/键数/数组长度 + 抽样值 | API 响应、配置文件 |
| `diet_csv` | 大 CSV → 列类型/distinct/min/max/avg + 抽样行 | 数据文件、报表导出 |
| `diet_estimate` | 任意文本 → token 估算 + 进上下文建议 | 决定"读全文 / 瘦身 / 跳过" |

## 压缩比例配置（settings）

插件注册 settings 命名空间 `token-diet`，在 Web UI 设置面板或 settings 文件中调整：

### 三档预设（`preset`，一键切换）

| 档位 | 适用场景 | headChars | maxKeys | maxSample | 压缩强度 |
| --- | --- | --- | --- | --- | --- |
| `light` | 需要细节的任务（代码评审、精确引用） | 2000 | 25 | 6 | 轻 |
| `balanced`（默认） | 大多数任务，骨架完整且 token 明显减少 | 800 | 12 | 3 | 中 |
| `aggressive` | 极端省 token（长会话、批量处理） | 300 | 6 | 2 | 强 |

### 逐项覆盖（可选，覆盖档位默认值）

`headChars` / `tailChars` / `maxKeywords` / `maxKeys` / `maxSample` / `maxDepth` / `maxSampleRows` / `maxColStats`

```yaml
# settings 文件示例
token-diet:
  preset: aggressive        # 切激进档
  headChars: 500            # 但文本头部保留 500 字符（覆盖档位 300）
  maxSampleRows: 8          # CSV 抽样行放宽到 8
```

### 优先级链

```
工具调用显式参数 > settings 逐项覆盖 > 档位默认值
```

即：模型调用 `diet_csv(csv, maxSampleRows: 10)` 时，10 优先于 settings 与档位。

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
