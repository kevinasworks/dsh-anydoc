# 测试报告

## 当前版本验证（v0.2.1，2026-11-06）

以 `v0.2.1` 提交 `73ddccd9236ad75176c61ec4880fd42eadf0a36f` 的 [完整 CI](https://github.com/kevinasworks/dsh-anydoc/actions/runs/42236379711) 为准：七种环境全部通过。Windows x64 为 **104 通过、0 失败、3 项既有平台条件跳过**；macOS arm64/x64、Linux x64/arm64 的 glibc 与 musl 环境均为 **107/107 通过**。所有环境的原生绑定检查及三条 DSH 版本线包级兼容检查均通过。

| 运行环境 | 通过 | 失败 | 跳过 |
| --- | --- | --- | --- |
| macOS ARM64 | 107 | 0 | 0 |
| macOS Intel x64 | 107 | 0 | 0 |
| Windows Server x64 | 104 | 0 | 3 |
| Linux glibc x64 / ARM64 | 各 107 | 0 | 0 |
| Linux musl x64 / ARM64 | 各 107 | 0 | 0 |

七种环境均在 Node.js 22 下执行真实文档转换、自检、worker 隔离及超时恢复，三条 DSH 线为 `0.2.0-rc.2`、`0.2.1-rc.5`、`0.2.2-rc.1`。macOS Apple 芯片另有本地真实 DSH Tool Call 记录；其他平台完整桌面交互尚未验收。

## 历史测试记录

以下保留开发阶段及早期提交的测试环境、数量和状态，用于追溯；各节“未执行”等状态描述对应当时环境，当前平台结论以本页顶部及 [PLATFORM_SUPPORT.md](PLATFORM_SUPPORT.md) 为准。

原始测试日期：2026-11-04（后续阶段记录见各节）。

标记说明：

- **PASS**：实际执行并验证结果内容。
- **FAIL**：实际执行但结果不符合预期。
- **NOT_TESTED**：缺少条件或样本，未执行。
- **LIMITATION**：上游或架构限制，不视为缺陷。

---

## 一、测试环境

| 项 | 值 |
| --- | --- |
| 机器 | MacBook Pro，Apple Silicon（arm64） |
| 系统 | macOS，Darwin 24.6.0 |
| DSH | 0.2.2-rc.1（Desktop / Electron 44.7.0） |
| Host 运行时 | Node v24.21.0，N-API 10 |
| 测试运行时 | Node v25.9.0 |
| profile | `desktop` |
| 插件 | `dsh-anydoc` 0.1.1（`link:` 安装；0.1.0 为同一份运行时代码，0.1.1 只改兼容声明与验证脚本） |
| AnyDoc | `@firecrawl/anydoc` 0.2.4 + `@firecrawl/anydoc-darwin-arm64` 0.2.4 |
| 测试命令 | `npm test`（`node --test test/*.test.mjs`） |

---

## 二、自动化测试汇总

| 用例文件 | 数量 | 通过 | 失败 | 覆盖内容 |
| --- | --- | --- | --- | --- |
| `test/paths.test.mjs` | 14 | 14 | 0 | 路径规范化、`~` 展开、Windows 盘符拒绝、realpath、凭据拒绝、`allowedRoots`、符号链接逃逸、输出命名、覆盖保护 |
| `test/engine.test.mjs` | 11 | 11 | 0 | worker/inprocess 双模式、逐字节一致性、超时杀进程、取消、资源预算、错误码映射、dispose |
| `test/conversion.test.mjs` | 28 | 28 | 0 | 23 个格式样本的内容正确性、错误扩展名、中文/空格/长文件名、扫描 PDF、源文件不变、资源导出 |
| `test/service.test.mjs` | 21 | 21 | 0 | 输出落盘、不覆盖、预览截断与参数上限、大小上限、缺失/空/目录输入、allow-list、批量扫描/递归/去重/隔离/上限、非数值并发回落、符号链接命名、能力报告、日志 |
| `test/tools.test.mjs` | 10 | 10 | 0 | 工具名与描述、参数/输出 schema、并发策略、参数校验、四种渲染 |
| `test/privacy.test.mjs` | 5 | 5 | 0 | 静态无 hosted OCR、断网进程内转换、断网 worker 转换、API Key 无关、OCR 失败不提上传 |
| `test/plugin.test.mjs` | 8 | 8 | 0 | `apply()` 契约、注册 3 工具、卸载释放、配置默认值与裁剪、schema 校验、格式表 |
| `test/fallback.test.mjs` | 2 | 2 | 0 | 故障注入：worker 入口缺失时回退 in-process；原生绑定缺失时给出平台化修复指引 |
| `test/platform.test.mjs` | 8 | 8 | 0 | win32 语义（`path.win32`）：UNC 前缀、大小写/跨盘包含判定、保留设备名、NTFS 冒号、长路径、文件占用错误映射；平台支持矩阵（darwin/win32/linux/未知组合） |
| **合计** | **107** | **107** | **0** | |

执行耗时约 3.9 s。

---

## 三、功能测试（格式与内容）

判定标准不是“没抛异常”，而是**检查生成内容**：关键文本是否存在、标题层级、表格行列、公式、备注、是否乱码、是否为空、是否异常截断、源文件是否变化。

| # | 用例 | 结果 | 证据（断言关键片段） |
| --- | --- | --- | --- |
| 1 | DOCX 中文+英文混合 | PASS | `季度技术评审报告 Quarterly Engineering Review`、`# 1. 背景 Background`、`***which converts office documents to Markdown locally.***` |
| 2 | DOCX 表格（含纵向合并） | PASS | `\| **指标 Metric** \| 目标 Target \| 实测 Actual \| 结论 \|`、`\| 转换耗时 \| 60s \| 0.8s \| 通过 PASS<br>通过 PASS \|`（合并单元格内容以 `<br>` 合并在起始格） |
| 3 | DOCX 公式（OMML） | PASS | `$x=\frac{-b\pm\sqrt{b^{2}-4ac}}{2a}$`、`$$`、`\sum_{i=1}^{n}` |
| 4 | DOCX 多级列表 | PASS | `1. One-one`、`   - i) One-two-a roman`、`Deep bullet` |
| 5 | DOCX 图片 | PASS | Markdown 中出现 alt 文本 `图 1：本地解析数据流`；`exportAssets` 导出 1 个 `image/png` 资源并在文末生成索引 |
| 6 | XLSX 多工作表 + 合并单元格 | PASS | `## 汇总 Summary`、`## 明细 Details`、`\| 华东 East \| 128000 \| 0.12 \| 含中文与 English \|` |
| 7 | XLS（旧二进制） | PASS | `## Values`、`\| Percent \| 15.5% \| fifteen and a half \|` |
| 8 | XLSB | PASS | `\| 42 \| 65.0% \| $1,234.50 \|` |
| 9 | PPTX 中文 + 演讲者备注 + 图片 | PASS | `## AnyDoc 解析能力演示`、`> 演讲者备注：强调所有解析都在本地完成。` |
| 10 | PPT（旧二进制） | PASS（表格降级为文本，见限制） | `Deck Title Slide`、`> Speaker note for the intro slide.` |
| 11 | ODT / ODS / ODP | PASS | 三份样本均命中预期文本与表格 |
| 12 | RTF（含公式） | PASS | `# Fixture Document`、`$x=\frac{-b\pm\sqrt{b^{2}-4ac}}{2a}$` |
| 13 | EPUB | PASS | `# Chapter One`、内部链接 `[Chapter Two](#epub-text-ch002-xhtml-chapter-two)` |
| 14 | CSV（含引号、逗号、中文） | PASS | `\| 张三 \| 工程师 \| 负责表格, 公式 \|`、`引号 "测试" 与换行` |
| 15 | CSV（UTF-16） | PASS | `\| 列一 \| 列二 \|` |
| 16 | 文本型 PDF | PASS | `# Fixture Document`、`**bold**`、`First numbered` |
| 17 | 长文档（13,902 字符） | PASS | 第 20 章末段完整；写盘长度 == `markdownChars` |
| 18 | 超长文档（294,801 字符） | PASS | 写入完整，预览按上限截断 |
| 19 | 文件名：中文+空格+全角括号 | PASS | `中文 文件名（含空格）.docx` 正常转换与输出 |
| 20 | 文件名：引号、`&`、`#` | PASS | `mixed 'quotes' & #hash.docx` 正常转换 |
| 21 | 文件名：40 个中文字符（长名） | PASS | 正常转换 |
| 22 | 扩展名错误但内容合法（`docx` 改名 `.bin`） | PASS | 按内容识别为 `docx`，并给出“扩展名不在支持表内”的警告 |
| 23 | 相对路径 | PASS | 会话工作目录下 `dsh-anydoc/test/fixtures/...` 解析成功 |
| 24 | 多文件批量 | PASS | 真实 Tool Call：10 个文件 10 成功，0 失败，0 跳过，242.9 ms |
| 25 | 批量中的同名冲突 | PASS | 已存在 `zh-mixed.md` 时依次生成 `zh-mixed-1.md`、`zh-mixed-2.md`，不覆盖 |
| 26 | 目录扫描（默认非递归） | PASS | 子目录文件未被纳入 |
| 27 | 目录扫描（递归） | PASS | 子目录文件被纳入 |
| 28 | 重复输入去重 | PASS | 同一文件重复列出只转换一次 |

---

## 四、异常测试

| # | 场景 | 结果 | 观察到的行为 |
| --- | --- | --- | --- |
| 1 | 文件不存在 | PASS | `FILE_NOT_FOUND`，附带提示 |
| 2 | 文件无读权限（chmod 000） | PASS | `PERMISSION_DENIED`（root 下跳过该断言） |
| 3 | 路径是目录 | PASS | `NOT_A_FILE` |
| 4 | 空文件（0 字节） | PASS | `EMPTY_FILE`，未进入解析引擎 |
| 5 | 文件过大 | PASS | `FILE_TOO_LARGE`；断言此时**没有启动任何 worker** |
| 6 | 加密文档（ODT） | PASS | `ENCRYPTED_DOCUMENT` |
| 7 | 损坏/截断文档 | PASS | `MALFORMED_DOCUMENT` |
| 8 | 扫描版 PDF | PASS | `NEEDS_OCR`，`pages=[1,2]`；真实 Tool Call 返回 `pages needing OCR: 1, 2` |
| 9 | 混合 PDF（部分页需 OCR） | PASS | `NEEDS_OCR`，`pages=[2]` |
| 10 | 不支持格式（纯文本 `.bin`） | PASS | `UNSUPPORTED_FORMAT` |
| 11 | 输出路径冲突 | PASS | 自动改名；`overwrite:true` 时才覆盖 |
| 12 | 不允许的路径（凭据目录） | PASS | `PATH_FORBIDDEN`（真实 Tool Call：`~/.ssh/id_rsa`） |
| 13 | 超出 `allowedRoots` | PASS | `PATH_OUTSIDE_ALLOWED_ROOTS`（输入与输出都校验） |
| 14 | 符号链接指向 allow-list 外 | PASS | 按 realpath 判定后拒绝 |
| 15 | 依赖加载失败 / worker 无法启动 | PASS | 故障注入：复制插件到临时目录并移除 `worker-entry.js`，引擎自动回退 in-process 并成功转换，`fallbackReason` 与日志均记录；`probe()` 在绑定不可用时返回 `nativeOk:false` + 原因 |
| 16 | Native Binding 加载失败（二进制本身不可加载） | NOT_TESTED | 未在真实安装中破坏 `.node` 去制造该故障；`probe()` 与 `NATIVE_UNAVAILABLE` 路径已实现 |
| 17 | 转换超时 | PASS | worker 模式：进程被 `SIGKILL`，池计数下降，后续转换恢复；inprocess 模式：`TIMEOUT_NOT_CANCELLED` |
| 18 | 调用取消（`exec.signal`） | PASS | worker 被终止，返回 `CANCELLED` |
| 19 | 恶意压缩包（zipbomb 等 8 例） | PASS | 全部 `RESOURCE_LIMIT`，无崩溃、无内存失控 |
| 20 | 批量中单文件失败 | PASS | 其余文件照常完成，失败项单独记录 |
| 21 | 空目录批量 | PASS | `NO_INPUT_FILES`，不是“成功 0 个” |
| 22 | 非法参数（缺参、类型错） | PASS | DSH 层抛 `invalid arguments`，工具体未执行 |

---

## 五、Windows 兼容性

本节为早期 macOS arm64 开发阶段的历史检查；`v0.2.1` 的 Windows Server CI 已通过，Windows 10/11 桌面场景仍需验收。以下保留原始检查范围：

| 项 | 结果 | 说明 |
| --- | --- | --- |
| 中文路径 | PASS（macOS） | `中文 文件名（含空格）.docx` |
| 含空格路径 | PASS（macOS） | 同上 |
| 特殊符号 `' & #` | PASS（macOS） | `mixed 'quotes' & #hash.docx` |
| Unicode 文件名 | PASS（macOS） | 中文、全角括号 |
| 长文件名 | PASS（macOS） | 40 个中文字符 |
| 路径分隔符 | PASS（逻辑） | `extensionOf`/`sanitizeSegment` 同时处理 `/` 与 `\` |
| Windows 绝对路径 | PASS（拒绝逻辑） | 在 POSIX 主机上明确报错，而不是当成文件名 |
| 相对路径 | PASS（macOS） | 会话工作目录 |
| 文件名大小写冲突 | NOT_TESTED | macOS 默认大小写不敏感，无法构造与 Windows 等价的冲突 |
| 文件占用 | NOT_TESTED | 未在 Windows 上测试“文件被占用” |
| 权限不足 | PASS（macOS） | chmod 000 |
| Junction / 符号链接绕过 | PASS（macOS 符号链接） | realpath 后判定，逃逸被拒；**Windows Junction 未实测** |
| 网络共享路径 | NOT_TESTED | 未构造 SMB 路径 |

该阶段仅核验 Windows 产物；此后 `v0.2.1` 已完成 Windows Server x64 原生运行验证，详见本页顶部。

---

## 六、隐私验证

| 验证 | 结果 | 方法 |
| --- | --- | --- |
| 源码不含 hosted OCR 调用 | PASS | 扫描 `lib/*.js` 剥离注释后，断言无 `ocr: 'hosted'`、无 `parseHosted`、无 `FIRECRAWL_API_KEY`、无 URL |
| 进程内转换不联网 | PASS | 把 `globalThis.fetch` 替换为抛错函数后完成 docx+assets 转换，断言 `fetch` 调用次数为 0 |
| worker 转换不联网 | PASS | 通过 `NODE_OPTIONS=--import=test/support/no-network.mjs` 让**子进程**同样禁用 `fetch`，转换与资源导出均成功 |
| 不依赖 Firecrawl API Key | PASS | 设置假 `FIRECRAWL_API_KEY` 后 PDF 转换照常 |
| OCR 失败不上传 | PASS | `NEEDS_OCR` 的错误信息不包含 hosted/parse 字样；上游代码只有显式 `ocr:'hosted'` 才会联网 |

真实 Tool Call 侧：`anydoc_capabilities` 返回 `networkPolicy: local-only`、`ocr: not-enabled-local-only`。

---

## 七、性能实测

本机实测（`node test/bench.mjs --runs 5`，worker 模式，测试运行时 Node v25.9.0；Host 内实测与下表同量级）：

| 文件 | 输入 | 输出字符 | 最小 | 中位 | 最大 |
| --- | --- | --- | --- | --- | --- |
| `zh-mixed.docx` | 39,086 B | 698 | 7.8 ms | 9.6 ms | 283.3 ms* |
| `zh-long.docx` | 37,767 B | 13,902 | 7.6 ms | 8.1 ms | 16.0 ms |
| `zh-heavy.docx` | 53,973 B | 294,801 | 18.5 ms | 18.9 ms | 26.2 ms |
| `zh-table.xlsx` | 5,894 B | 410 | 0.5 ms | 0.6 ms | 7.6 ms |
| `zh-slides.pptx` | 36,256 B | 306 | 1.1 ms | 1.2 ms | 7.9 ms |
| `docx-text.docx` | 10,159 B | 1,295 | 1.3 ms | 1.5 ms | 6.7 ms |
| `pdf-text.pdf` | 90,060 B | 1,074 | 6.0 ms | 6.3 ms | 17.2 ms |
| `pptx-pres.pptx` | 15,734 B | 273 | 1.1 ms | 1.1 ms | 7.7 ms |
| `xlsx-sheet.xlsx` | 7,106 B | 396 | 0.7 ms | 0.7 ms | 10.3 ms |

\* 首次调用包含 worker 进程冷启动，属正常抖动。

并发（同一目录 10 个文件，pool=2）：

| 并发 | 墙钟 |
| --- | --- |
| 1 | 104.0 ms |
| 4 | 119.3 ms |

小文件场景下并发没有收益：单文件解析只需 0.5–19 ms，进程调度与 IPC 开销占主导。并发配置的意义在于大量中等/大文件时避免串行等待，而不是提升小文件吞吐。**这些是插件实测数据，不是上游宣传值。**

真实 Tool Call（运行中的 DSH Host，worker 模式）观察到的数字：

- `zh-mixed.docx`：39,086 字节 → 698 字符，25.8 ms
- 批量 10 个文件（3 并发）：242.9 ms，单文件 9.4–41.1 ms（含 294,801 字符的大文档）

---

## 八、真实集成验证（运行中的 DSH）

这一节全部来自**真实 Tool Call**，不是本地函数调用。

| # | 验证项 | 结果 | 证据 |
| --- | --- | --- | --- |
| 1 | 安装为 DSH Bundle | PASS | `plugin_manager install_bundle` 返回 `"application": "applied"`，`bundle: dsh-anydoc`，`version: 0.1.0` |
| 2 | 工具被注册进模型工具表 | PASS | 会话工具表新增 `anydoc_convert`、`anydoc_batch_convert`、`anydoc_capabilities` |
| 3 | 能力自检 | PASS | `anydoc_capabilities {selfTest:true}` → `native binding: ok · worker: ok`，`self test: passed` |
| 4 | 单文件真实转换 | PASS | `zh-mixed.docx` → `$DSH_HOME/anydoc-output/zh-mixed.md`，698 字符，25.8 ms |
| 5 | 批量真实转换 | PASS | 10 个文件全部成功，242.9 ms，输出目录 `$DSH_HOME/anydoc-output` |
| 6 | 中文/长名/冲突命名 | PASS | `长长长….md`、`中文 文件名（含空格）.md`、`zh-mixed-1.md`、`zh-mixed-2.md` |
| 7 | 相对路径按会话目录解析 | PASS | `dsh-anydoc/test/fixtures/...` 成功 |
| 7b | 批量容错（整目录含恶意/损坏样本） | PASS | 对 `test/fixtures/upstream` 26 个条目：20 成功、5 失败（zipbomb→`RESOURCE_LIMIT`、空文件→`EMPTY_FILE`、加密→`ENCRYPTED_DOCUMENT`、截断→`MALFORMED_DOCUMENT`、扫描 PDF→`NEEDS_OCR`）、1 跳过（`.md` 扩展名），整批未中断，254.2 ms |
| 8 | 扫描 PDF 的 OCR 语义 | PASS | `NEEDS_OCR` + `pages needing OCR: 1, 2` + 本地处理提示 |
| 9 | 凭据路径拒绝 | PASS | `~/.ssh/id_rsa` → `PATH_FORBIDDEN` |
| 10 | 新 Agent 可见性 | PASS | 独立 subagent 实测：三个工具全部可见，`anydoc_capabilities` 自检通过 |
| 11 | 插件可管理 | PASS | `Config.listConfigs` 能读到 `include:anydoc` 的完整配置 schema（14 个字段、默认值正确） |
| 12 | 热加载生效 | PASS | 安装返回 `application: "applied"`，无需重启即可调用 |
| 13 | 重启后持久化 | **PASS** | DSH 重启后三个工具仍可用；`anydoc_capabilities {selfTest:true}` 返回 `native binding: ok`、`self test: passed`；且符号链接源转换为 `调用验证-alias.md`，证明加载的是最新磁盘代码 |

### 生命周期实测（停用 / 启用 / 卸载 / 重装）

全部通过 `plugin_manager` 官方操作执行，并逐步核对了 profile 文件与运行态：

| 步骤 | 操作 | 观察结果 |
| --- | --- | --- |
| 1 | `set_bundle` `enabled: false` | 返回 `"application": "applied"`；`Config.listConfigs` 中 `include:anydoc` 消失（0 条），插件已卸载 |
| 2 | `set_bundle` `enabled: true` | 行重新出现；`anydoc_capabilities {selfTest:true}` 再次 `passed`；`cordis.patch.yml` 与安装前**逐字节相同**（只记录偏离 bundle 的覆盖，回归默认后自动移除） |
| 3 | `remove_bundle` | pnpm 输出 `- dsh-anydoc link:…`；profile `package.json` 的依赖与 `dsh.profile.bundles` 中该条被移除，其他条目原样；`Config.listConfigs` 为 0 条 |
| 4 | `install_bundle` 重新安装 | 返回 `"application": "applied"`；`package.json` 恢复为首次安装时的形态；三个工具恢复可用 |

补充观察：`remove_bundle` 之后 profile 的 `node_modules/dsh-anydoc` 符号链接仍然存在（指向本插件目录，重装后继续复用）。这是 pnpm `link:` 的既有行为，残留链接不被任何 bundle 引用，不影响加载。

安装时 pnpm 会打印一条 peer 警告：

```text
[WARN] The package dsh-anydoc, which you have just pnpm linked, has the following peerDependencies:
  - @deepseek-ai/dsh-tools@>=0.2.2-rc.1 <0.3.0, - @deepseek-ai/schemastery@^3.19.0
The linked in dependency will not resolve the peer dependencies from the target node_modules.
```

这是 `link:` 安装的固有提示：这两个 peer 由 DSH 的 runtime resolution 解析到安装内的同版本包，不需要 pnpm 在插件目录安装副本。实际加载与三个工具的运行均已验证正常。


### 交付代码与运行实例的一致性（已闭环）

插件目录通过 `link:` 安装，DSH 对已加载的 ESM 模块做进程内缓存，因此**代码改动需要重启 Host 才会生效**。安装完成之后又对 `lib/service.js` 做了三处防御性补强：

1. `previewChars` 入参上限 200,000 字符；
2. 批量 `concurrency` 传入非数值时回落配置默认值；
3. 输出文件按调用方给出的文件名命名，而不是符号链接解析后的目标名。

**重启后已完成闭环验证**：

- 三个工具在重启后仍然可用（持久化成立）；
- 对符号链接源 `调用验证-alias.docx` 的转换输出为 `调用验证-alias.md`（第 3 条补强生效），证明运行实例已加载最新磁盘代码；
- `anydoc_capabilities {"selfTest": true}` 在重启后返回 `native binding: ok`、`worker: ok`、`self test: passed`。

即：**交付代码 = 运行代码**，无遗留差异。

### 关于“重启后持久化”

**已实测通过**（DSH 重启后复验）：

1. 三个工具仍在工具表中，`anydoc_convert` / `anydoc_batch_convert` / `anydoc_capabilities` 均可调用；
2. `anydoc_capabilities {"selfTest": true}` → `native binding: ok · worker: ok`、`self test: passed`；
3. 转换符号链接源 `调用验证-alias.docx` 输出 `调用验证-alias.md`，说明加载的是磁盘最新代码，而非安装时的缓存模块。

持久化载体（重启前已确认）：

- profile 的 `package.json` 写入 `"dsh-anydoc": "link:<插件目录>"`，并在 `dsh.profile.bundles` 追加该项；
- `pnpm-lock.yaml` 记录对应 link 条目；`cordis.patch.yml` 与安装前逐字节相同；
- `plugin_manager list_bundles` 显示 `installed: true`、`enabled: true`、`availability: "profile"`。

已知边界：若插件目录所在磁盘不可用，该 bundle 会在启动时被跳过并报告，不影响其他插件启动。

### 变更复核（2026-11-05，DSH 再次重启后）

| 检查 | 结果 |
| --- | --- |
| DSH 版本 | `0.2.2-rc.1`，与应用包版本、GitHub 最新 tag `dsh-v0.2.2-rc.1`、桌面端 nightly feed 一致 → **未变化** |
| AnyDoc 版本 | 锁定并安装 `0.2.4`；npm `latest` = `0.2.4`，上游最新 tag `v0.2.4`，远端 HEAD 仍为 `e7178e0…` → **未变化** |
| 插件运行态 | `anydoc_capabilities {selfTest:true}` → `native binding: ok · worker: ok`、`self test: passed` |
| 真实转换 | `docx-text.docx` → 1,295 字符，15.9 ms |
| 自动化测试 | 107 / 107 通过 |
| 结论 | **不需要升级，也不需要重新适配** |

同时观察到宿主环境的**他人变更**（非本插件引起，供排查参考）：

- `dsh-web-search-pro` 已从 `dsh.profile.bundles` 移除（依赖仍在 `package.json`，属“停用”而非卸载）；
- `dsh-context` 升级到 `0.81.0`，并因重新启用被追加到 bundle 列表末尾；
- 由于 `web` 行仍配置 `searchProvider/fetchProvider: web-search-pro`，该 provider 已不可用，`web_search` / `web_fetch` 会报 `configured web provider "web-search-pro" is not registered`。dsh-anydoc 不依赖 `web` 服务，未受影响。

---

## 九、安装前后环境对比

安装前快照：`.backup/pre-install-20261104T200928/`（含 SHA-256）。

| 文件 | 变化 |
| --- | --- |
| `profiles/desktop/package.json` | 新增依赖 `dsh-anydoc: link:/path/to/dsh-anydoc`；`dsh.profile.bundles` 末尾追加 `dsh-anydoc`。其余字段完全不变 |
| `profiles/desktop/cordis.patch.yml` | **无变化**（逐字节相同） |
| `profiles/desktop/pnpm-lock.yaml` | 仅新增 `dsh-anydoc` 一条 link 记录 |

其他 bundle 状态未变：`dsh-context`、`cc-safety-net`、`@taxueseek/argo-dsh`、`last30days-skill-cn` 仍为已安装/启用；`dsh-web-search-pro@0.2.3` 在**安装前**即因 peer 版本范围不含 `0.2.2-rc.1` 而报 `incompatible-version`，与本次安装无关（未做任何改动）。

---

## 十、测试过程中发现并修复的问题

| # | 问题 | 根因 | 修复 |
| --- | --- | --- | --- |
| 1 | `sanitizeSegment` 抛 `replaceAll called with a non-global RegExp` | 误用 `replaceAll` 处理非全局正则 | 改用 `String.prototype.replace` |
| 2 | 引擎 `dispose()` 后仍可继续转换 | 释放时把 `activeMode` 改为 `inprocess`，掩盖了已释放状态 | 增加 `disposed` 标志，`convert`/`probe` 直接拒绝 |
| 3 | `exec.signal` 在 worker 启动窗口内中止会丢失 | 监听器在 abort 之后才注册 | 在 `#dispatch` 与 in-process 读取字节后补 `signal.aborted` 检查 |
| 4 | in-process 超时测试不稳定 | 小文档转换快于 1 ms 计时器 | 生成 3,000 段的 `zh-heavy.docx`（约 19 ms）用于超时用例 |
| 5 | 资源导出断言把所有资源当成图片 | 样本里同时含 OLE 对象（`application/vnd.ms-ole-object`） | 断言改为“至少一个 `image/*`”，其余只校验字节非空 |
| 6 | 批量成功判定过严 | 目录里的 `.txt` 跳过会让整批 `success=false` | 改为“无失败即成功”，跳过数量单独统计 |
| 7 | 中文表格生成器未写入单元格文本 | 测试样本生成脚本 bug | 修正 `generate.py` 并重新生成全部样本 |
| 8 | 失败渲染缺少处理提示 | `hintForCode` 只覆盖部分错误码 | 补齐 `FILE_NOT_FOUND`/`EMPTY_FILE`/`PERMISSION_DENIED` 等 |

每次修复后均重跑相关用例并执行完整回归（最终 107 项）。上述问题均在**插件自身代码或测试样本**中，没有修改上游 AnyDoc，也没有为了通过测试而放宽断言或吞异常。

---

## 十一、向下兼容验证（2026-11-05，v0.1.1）

目标：让插件在更早的 DSH 线上也能加载与运行，而不只在当前安装的 0.2.2-rc.1 上。

### 11.1 接口对比（静态，读自各版本发布的类型声明）

以 `@deepseek-ai/dsh-tools` 三个版本的 `lib/types/*.d.ts` 为准：

| 接口 | 0.2.0-rc.2 | 0.2.1-rc.5 | 0.2.2-rc.1 | 插件是否依赖差异 |
| --- | --- | --- | --- | --- |
| `defineTool(options)` | 同签名 | 同签名 | 同签名 | 无差异 |
| `ParameterSchemaSpec` / `ValueSchemaSpec`（作者 DSL） | 相同 | 相同 | 相同（仅新增 `projectToolSchema`） | 无差异 |
| `ToolOutputDefinition`（`schema` + `render` + 可选 `presentationMeta`） | 相同 | 相同 | 相同 | 无差异 |
| `ToolDefinition`（`execute(args, exec)`、`timeoutMs`、`isConcurrencySafe` 等） | 相同 | 相同 | 相同 | 无差异 |
| `ToolRunContext`（`signal`、`agent`） | 相同 | 相同 | 相同 | 无差异 |
| `ctx.tools.register(definition)` | 单参数 | 单参数 | `(definition, options?)` | 插件只用单参数，三种都能用 |
| `engines.dsh` 字段解析 | **不存在**（app-boot 无该字段处理） | 不存在 | 存在 | 旧线上该字段被忽略，不影响加载 |
| `dsh.bundle` / `bundlePatch` | 存在 | 存在 | 存在 | 三线都支持 Bundle |

### 11.2 包级实跑（每条线真实安装该线的 dsh-tools 后执行插件代码）

`node test/check-compat.mjs`：

```text
DSH         dsh-tools     schemastery  cordis   result
0.2.0-rc.2  0.2.0-rc.2    3.18.5       4.0.5    PASS  (warnings=0)
0.2.1-rc.5  0.2.1-rc.5    3.18.5       4.0.5    PASS  (warnings=0)
0.2.2-rc.1  0.2.2-rc.1    3.19.0       4.1.0    PASS  (warnings=0)
```

每条线在沙箱里实际完成了：配置 schema 加载与裁剪、`defineTool` 编译参数/输出 schema、非法参数被拒、能力自检（真实转换微型 CSV）、真实 docx 转换并读回文件、`output.render` 产出 text block、以及用替身 Cordis 上下文调用 `apply()` 注册三个工具。

### 11.3 版本范围语义（用 semver 7 逐版本核对）

范围：`>=0.2.0-rc.2 <0.2.1-0 || >=0.2.1-rc.2 <0.2.2-0 || >=0.2.2-rc.1 <0.2.3-0`

| 应接受 | 结果 | 应拒绝 | 结果 |
| --- | --- | --- | --- |
| `0.2.0-rc.2`、`0.2.1-rc.2`~`rc.5`、`0.2.2-rc.1`、`0.2.2` | 全部接受 ✅ | `0.2.0-rc.1`、`0.2.1-alpha.5`、`0.2.1-rc.1`、`0.2.2-alpha.2/3`、`0.2.3`、`0.3.0`、`1.0.0` | 全部拒绝 ✅ |

不匹配项：0。

### 11.4 结论

| 项 | 结果 |
| --- | --- |
| 三条目标 DSH 线的包级兼容 | **PASS** |
| 当前安装的 0.2.2-rc.1 回归（107 项） | **PASS** |
| 版本范围边界 | **PASS**（semver 7 核对，0 处不符） |
| 真实旧版 DSH 桌面端整体启动 | **NOT_TESTED**（见 KNOWN_LIMITATIONS） |

## 十二、平台兼容验证（Windows / Apple Silicon，v0.2.0）

目标：让插件在 Windows 10+ x64 与 Apple 芯片 macOS 上都可用。

### 12.1 代码层：平台规则可测化

新增 `lib/platform.js`，把平台相关规则做成纯函数（显式接收 `path` 实现与 `win32` 标记），`lib/paths.js` 用真实的 `node:path` / `process.platform` 调用它，测试用 `path.win32` 跑 Windows 分支。

修复/加固的点：

| 问题 | 处理 |
| --- | --- |
| `\\?\UNC\server\share` 被错误剥成 `UNC\server\share` | `stripWindowsPrefix` 区分 UNC 形式 |
| 文件名含 `:` 在 Windows 上写成 NTFS 数据流 | win32 下替换为 `_` |
| `CON` / `NUL` / `COM1` 等保留设备名无法创建 | win32 下加前导 `_` |
| 资源索引用 `path.relative`，Windows 下出现反斜杠 | Markdown 中统一为 `/` |
| 路径接近 MAX_PATH 时无提示 | win32 下超过 240 字符写入 `warnings` |
| 文件被占用时只报通用 IO 错误 | `EBUSY` / `EPERM` → `PERMISSION_DENIED` 并说明“被其他程序占用” |
| 原生绑定加载失败的消息不含平台信息 | 错误里加入 `platform/arch` 与修复指引；win32+arm64 明确说明上游无产物 |

### 12.2 平台规则单测（7 项，PASS）

用 `path.win32` 在 macOS 上执行 Windows 分支：UNC 与扩展长度前缀、大小写不敏感与跨盘包含判定、保留设备名、NTFS 冒号、长路径告警、文件占用错误映射、POSIX 行为不变。

测试入口也做了跨平台处理：`npm test` 现在走 `test/run-tests.mjs`，自己展开文件列表再调用 `node --test`，不依赖 shell 的 glob（cmd.exe 不展开）。在 Windows 上，3 个需要创建符号链接或修改权限的用例会显式跳过（Windows 下建符号链接需要开发者模式），其余 103 项按平台的 `path` 实现推导期望值。

### 12.3 打包与安装选择（实测）

| 验证 | 结果 |
| --- | --- |
| `@firecrawl/anydoc@0.2.4` 声明两个平台 optionalDependency | PASS（`darwin-arm64`、`win32-x64-msvc`，均为 0.2.4） |
| 本机已安装二进制 | PASS — `anydoc.darwin-arm64.node`，Mach-O 64 arm64，7,007,312 字节 |
| 从 npm 下载 Windows 产物 | PASS — `anydoc.win32-x64-msvc.node`，PE x64，8,275,456 字节 |
| macOS 生产安装（仅 dependencies） | PASS — 装上 `anydoc` + `anydoc-darwin-arm64`，实跑转换 1,295 字符 |
| Windows x64 安装选择（`--os=win32 --cpu=x64`） | PASS — 只装 `anydoc-win32-x64-msvc`，二进制 PE machine `0x8664` |
| Windows ARM 安装（`--os=win32 --cpu=arm64`） | 预期失败 — 只装到 `anydoc`，无原生绑定；插件报 `NATIVE_UNAVAILABLE` 并说明原因 |
| 上游 `darwin-x64` 产物 | PASS — `anydoc.darwin-x64.node`，Mach-O 64 **x86_64**，7,456,808 字节 |
| 上游 Linux 产物（glibc / musl，x64 / arm64） | PASS — 四个 `.node` 均为 ELF：`linux-x64-gnu` 8,189,088 B（x86_64）、`linux-arm64-gnu` 7,222,168 B（arm64）、`linux-x64-musl` 8,206,864 B（x86_64）、`linux-arm64-musl` 7,230,808 B（arm64） |
| 平台支持矩阵（`platformSupport`） | PASS — 单测覆盖 darwin/win32/linux 与未知组合；win32/arm64 返回 `unsupported` 并带替代方案提示 |
| macOS x64 依赖链（Apple 芯片 + Rosetta，2026-11-06） | PASS — x64 Node v24.22.2 + `anydoc.darwin-x64.node`：插件注册 3 个工具，docx 1,295 字符、xlsx 410 字符转换成功，`anydoc_capabilities` 报 `arch x64`、`selfTest passed` |

### 12.4 当时尚未执行的项目（历史状态）

- macOS Intel 实机与 x64 Electron 宿主：Rosetta 测试只覆盖 x64 进程内的插件与原生绑定，不代表 Intel 硬件已验证。
- Linux 运行验证：本机无容器运行时与 Linux VM，只核验了四个 ELF 产物与代码的平台无关性，未跑测试或真实转换。
- Windows on ARM 运行验证：无设备；仅验证了“检测到 unsupported 并给出替代方案”的行为。

Windows 实机上的测试执行、真实 Tool Call、进程隔离、文件占用与长路径都只有**代码/打包级验证**，没有运行环境。逐项矩阵与验收清单见 [PLATFORM_SUPPORT.md](PLATFORM_SUPPORT.md)。

## 十三、复现方式

```bash
cd /path/to/dsh-anydoc
npm install                 # 含 devDependencies，仅本机测试需要
python3 test/fixtures/generate.py
npm test
node test/bench.mjs
node test/check-compat.mjs   # 向下兼容：为每条支持的 DSH 线建沙箱实跑
```

真实集成复验：在 DSH 中调用

```text
anydoc_capabilities {"selfTest": true}
anydoc_convert {"sourcePath": "<任意 docx>"}
anydoc_batch_convert {"directory": "<含文档的目录>"}
```

## 十四、发布前检查（2026-11-06）

面向 GitHub 公开发布的一次性检查，详细说明见 [PUBLISHING.md](PUBLISHING.md)。

| 检查 | 方法 | 结果 |
| --- | --- | --- |
| 许可证材料齐备 | 核对 `LICENSE`、`THIRD_PARTY_NOTICES.md`、`licenses/anydoc-LICENSE.txt` | 齐备；上游许可原文 SHA-256 `03a9e7657aac6536fb6458bd220347c4e7f85bd0a51d8d9e8528530b7a682ade`，与上游提交 `e7178e0…` 一致 |
| 安装包内容 | `npm pack`（29 个文件）后解包核对 | 含 `LICENSE`、`THIRD_PARTY_NOTICES.md`、`licenses/`；不含 `test/`、`node_modules/`、`.backup/`、`.audit/` |
| 包内隐私 | 对解包后的全部文件检索个人路径、用户名与凭据模式 | 无命中 |
| 隔离安装与功能 | 在临时目录 `npm install <tgz> --omit=dev`，补装宿主 peer 后加载包入口 | 三个工具注册成功；`anydoc_capabilities` 自检 `passed`；真实 docx 转换 1,295 字符 |
| 回归 | `npm test` / `check:compat` / `check:platforms` | 107/107 通过；三条 DSH 线 PASS；平台产物 PASS |

结论见 `PUBLISHING.md`：版权署名已确认为 **Kevin Zheng** 后，源码公开与安装包分发均为 **READY**；GitHub 直接安装为 **NOT_TESTED**（无远程仓库）。

## Windows CI 故障修复验收（2026-11-06，v0.2.1 之前的提交）

验证提交：`f0430ff5b0acc329bc29ca0f7f6d7103715368e4`。[完整 CI](https://github.com/kevinasworks/dsh-anydoc/actions/runs/42230021943)。

| 原失败项 | 根因与修复 | Windows 结果 |
| --- | --- | --- |
| 扫描 PDF、错误映射、OCR 隐私断言（3 项） | Git 换行转换破坏 PDF 字节偏移；新增 `.gitattributes`，所有文档样本禁止文本转换。原文件返回 `needsOcr`，CRLF 副本可复现 `invalid file trailer`。 | 全部通过 |
| worker 回退、缺少原生绑定（2 项） | 测试把盘符路径直接传给动态 import；改用 `pathToFileURL`。 | 全部通过 |
| POSIX 大小写语义（1 项） | 测试依赖宿主默认 path 实现；显式注入 `path.posix`。 | 通过 |
| 无效白名单配置（1 项） | 写死 POSIX `/tmp`；改用独立临时目录，核对实际规范路径。 | 通过 |
| 白名单内转换（1 项） | 同步与异步 realpath 对 DOS 8.3 名称解析不一致；配置改用 native realpath 并去掉扩展前缀，与输入/输出规范化一致。增加规范路径一致性断言，继续验证内外输入/输出边界。 | 通过 |

同时修正后续 CI 问题：平台核验按当前 runner 检查绑定、不再写死 macOS；Windows 兼容沙箱使用 junction；macOS runner 从已退役的 14 改为 15。超时测试改为确定性抑制 worker 回复，验证 TIMEOUT、真实子进程 kill、移出池及后续转换恢复，避免依赖真实文档耗时恰好超过 1 ms。

最终结果：macOS arm64 106/106；Windows x64 103 通过、0 失败、3 跳过。三项跳过保持原有条件：POSIX 专属盘符拒绝测试、两个需要 Windows 符号链接权限的测试。没有新增跳过，也没有放宽错误码或白名单断言。两端的安装、产物核验及三条 DSH 线包级检查均通过，warnings=0。未修改上游 AnyDoc，不代表已验收所有 Windows 桌面交互场景。
