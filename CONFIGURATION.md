# 配置说明

插件配置写在 profile 的 `cordis.patch.yml` 中该行下面，或通过 DSH 的 Plugins 界面修改。行 id 为 `anydoc`，模块名 `dsh-anydoc`。

当前安装使用 bundle 自带的 `cordis.patch.yml`，即 `config: {}`（全部默认值）。要覆盖时，在 **profile** 的 `cordis.patch.yml` 追加：

```yaml
- id: anydoc
  name: dsh-anydoc
  config:
    engine: worker
    maxFileBytes: 104857600
    timeoutMs: 60000
    batchConcurrency: 2
    outputRoot: ~/Documents/anydoc-out
```

> 注意：同 id 的覆盖会**整体替换** `config`，不是逐字段合并。只写想改的字段，其余字段会回到 schema 默认值。

配置 schema 已在运行中的 DSH 内实际读取验证（`Config.listConfigs`），下面每一项都与该 schema 一致。

---

## 完整字段表

| 字段 | 类型 | 默认值 | 允许范围 | 说明 |
| --- | --- | --- | --- | --- |
| `engine` | `'worker' \| 'inprocess'` | `worker` | 二选一 | 转换执行位置。`worker` 在子进程跑，超时可真正终止；`inprocess` 在 Host 进程内跑。非法值回落 `worker`。 |
| `outputRoot` | `string` | `$DSH_HOME/anydoc-output`（默认 `~/.dsh/anydoc-output`） | 任意可写目录 | 未显式传 `outputDir` 时的输出目录。空字符串表示用默认值。支持 `~`。 |
| `maxFileBytes` | `number` | `104857600`（100 MiB） | 1 MiB – 2 GiB | 单文件大小上限。超限直接拒绝，文件不会进入解析引擎。 |
| `previewChars` | `number` | `8000` | 500 – 200000 | 单文件结果里内联返回的 Markdown 字符数。调用时可用 `previewChars` 参数覆盖。 |
| `maxOutputChars` | `number` | `5000000` | 1000 – 100000000 | 转换结果最大字符数。超过则不写文件、不返回预览，报 `OUTPUT_TOO_LARGE`。 |
| `timeoutMs` | `number` | `60000` | 1000 – 600000 | 单文件转换期限。worker 模式到期杀进程；inprocess 模式只能停止等待。 |
| `batchConcurrency` | `number` | `2` | 1 – 8 | 批量转换默认并发数。调用时可用 `concurrency` 覆盖（同样上限 8）。 |
| `batchMaxFiles` | `number` | `50` | 1 – 500 | 单次批量调用最多处理的文件数。超出部分会在 `warnings` 中明确说明未处理。 |
| `workerPoolSize` | `number` | `2` | 1 – 4 | worker 模式可同时存在的子进程数。 |
| `workerStartTimeoutMs` | `number` | `20000` | 1000 – 120000 | 子进程从启动到报告绑定就绪的等待上限。 |
| `allowedRoots` | `string[]` | `[]` | 绝对路径数组 | **额外**允许访问的根目录。空数组表示“不额外限制”。非绝对路径或不存在的目录会被忽略并告警。 |
| `exportAssets` | `boolean` | `false` | true/false | `anydoc_convert` 未显式传 `exportAssets` 时的默认行为。 |
| `maxAssetBytes` | `number` | `67108864`（64 MiB） | 0 – 512 MiB | 单次转换允许导出的资源字节总量。超出部分跳过并告警。 |
| `keepMarkdownFile` | `boolean` | `true` | true/false | 是否把转换结果写成 `.md` 文件。设为 `false` 时只返回预览。 |

所有数值字段都会被裁剪到上表范围内（不会因为写出 0 或负值而失效）；非数值会导致该行配置校验失败并在启动时报告。

---

## 工具级参数（每次调用可覆盖）

### `anydoc_convert`

| 参数 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `sourcePath` | string | 是 | — | 绝对路径，或相对会话工作目录的路径。支持 `~`。 |
| `outputDir` | string | 否 | `outputRoot` | 本次输出的目录。 |
| `overwrite` | boolean | 否 | `false` | 是否覆盖同名输出。为 false 时自动改用 `-1`、`-2` 后缀。 |
| `exportAssets` | boolean | 否 | 配置值 | 是否导出内嵌资源。 |
| `writeFile` | boolean | 否 | `true` | 为 false 时只返回预览，不写 `.md`。 |
| `previewChars` | number | 否 | 配置值 | 本次预览长度。 |

### `anydoc_batch_convert`

| 参数 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `paths` | string[] | 二者其一 | — | 文件或目录列表。 |
| `directory` | string | 二者其一 | — | 扫描单个目录。 |
| `recursive` | boolean | 否 | `false` | 是否递归子目录。 |
| `outputDir` | string | 否 | `outputRoot` | 输出目录。 |
| `overwrite` | boolean | 否 | `false` | 是否覆盖。 |
| `exportAssets` | boolean | 否 | `false` | 是否导出资源。 |
| `concurrency` | number | 否 | `batchConcurrency` | 并发数，上限 8。 |
| `writeFile` | boolean | 否 | `true` | 是否写文件。 |

目录扫描只收文档支持的扩展名；显式列出的文件即使扩展名未知也会尝试转换（内容可能仍是受支持格式）。

### `anydoc_capabilities`

| 参数 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `selfTest` | boolean | 否 | `false` | 用插件自建的微型 CSV 走一遍完整转换链路。不会读取任何用户文档。 |

---

## 返回值要点

单文件结果字段：

```text
success, sourcePath, resolvedPath, detectedFormat, formatSource, outputPath,
markdownChars, previewChars, markdownPreview, truncated, warnings,
errorCode, errorMessage, pages, assets[{id,path,mediaType,bytes}],
durationMs, engine, bytes
```

- `formatSource`：`content`（内容签名判定）/ `extension`（无签名，靠扩展名）/ `none`。
- `truncated` 为 `true` 时，`markdownPreview` 只是前 `previewChars` 个字符，完整内容在 `outputPath`。
- `pages` 仅在 `NEEDS_OCR` 时非空，是 1 起算的页码。
- `engine` 是本次实际使用的方式（可能因回退与配置不同）。

批量结果字段：

```text
success, total, succeeded, failed, skipped, outputDir, durationMs,
results[{sourcePath,status,detectedFormat,outputPath,markdownChars,errorCode,errorMessage,durationMs}],
warnings, errorCode, errorMessage
```

`success` 表示“没有任何文件失败”。`skipped`（如不支持的扩展名）不影响 `success`，但会出现在结果与统计里，不会被隐藏。

---

## 权限与安全边界

- 插件在 Host 进程中运行，使用进程自身的文件权限，**不额外申请系统权限**，也不扩大 DSH 的沙箱策略。
- 只访问用户显式给出的路径、其所在目录（目录扫描），以及输出目录。
- 以下位置**一律拒绝读取**：`.ssh/`、`.gnupg/`、`.aws/credentials`、`Library/Keychains/`、`.dsh/credentials*`、`.netrc`。
- 输出永远落在 `outputDir`/`outputRoot` 之内：文件名会被清洗为单段名，并二次校验不逃逸。
- 默认不覆盖任何已存在文件。
- 不读取环境变量中的密钥；不发起网络请求。

### 关于 `allowedRoots`

`allowedRoots` 为空表示“信任模型给出的路径”，这是默认行为，适合个人自用。若希望在某个受限工作区里强制收口，把它设成白名单：

```yaml
- id: anydoc
  name: dsh-anydoc
  config:
    allowedRoots:
      - ~/Documents/项目A
      - /tmp/anydoc-staging
```

设置后，输入和输出都必须位于这些目录（按 realpath 判定，符号链接不能逃逸）之内，否则返回 `PATH_OUTSIDE_ALLOWED_ROOTS`。

---

## 输出目录结构

```text
<outputRoot>/
  report.md                    # 转换结果
  report-1.md                  # 同名冲突时的下一个可用名
  report.assets/               # 仅在 exportAssets=true 时
    report-1.png
    report-2.emf
```

Markdown 末尾会追加资源索引：

```markdown
## Exported assets

Embedded resources extracted next to this file. Image content itself is not analysed.

- `report.assets/report-1.png` — image/png, 4211 bytes (from `word/media/image1.png`)
```

插件不会自动清理这些文件；删除由用户决定。

---

## 日志

每次转换写一行 info 日志（不含文档内容）：

```text
dsh-anydoc: converted /path/report.docx -> /path/out/report.md format=docx chars=13902 assets=0 41.1ms engine=worker
```

失败写 warn 日志，包含错误码与原因；批处理结束写一行汇总。
