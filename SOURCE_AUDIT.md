# 源码与环境审计

审计时间：2026-11-04
审计对象：本机实际安装的 DeepSeek Harness、以及官方仓库 `firecrawl/anydoc` 与 npm 包 `@firecrawl/anydoc@0.2.4`。

本文件记录**实际检查到的事实**，包含命令输出与源码位置；未验证的内容单独标注，不作推断。

---

## 一、DSH 环境审计

### 1.1 实际版本与平台

| 项 | 实测值 | 来源 |
| --- | --- | --- |
| DSH 版本 | `0.2.2-rc.1` | `dsh --version` |
| 操作系统 | macOS（Darwin 24.6.0，RELEASE_ARM64_T6000） | `uname -a` |
| CPU 架构 | `arm64` | `arch` |
| 终端 Node | `v25.9.0` | `node --version` |
| Host 进程 Node / Electron | `v24.21.0` / `44.7.0`，N-API 10 | 工具内 `process.version` / `process.versions.electron` |
| npm | `11.19.1` | `npm --version` |
| git | `2.50.1 (Apple Git-155)` | `git --version` |
| 全局 pnpm | 不在 PATH | `pnpm --version` → not found |
| profile 内 pnpm | `11.28.5`，由 `plugin_manager` 通过 launcher facts 提供 | 安装返回的 pnpm 日志 |
| DSH_HOME | `$DSH_HOME`（默认 `~/.dsh`） | 环境变量 |
| Profile | `desktop` | `DSH_PROFILE` |
| Profile 目录 | `$DSH_HOME/profiles/desktop` | `DSH_PROFILE_DIR` |
| 当前工作目录 | `/path/to/workspace` | `pwd` |
| DSH 实现位置 | 桌面端安装包内的 `app.asar/dsh/` | 运行上下文 |

> 注意：Desktop 版把 DSH 实现打包在 `app.asar` 中。普通 `ls`/`cat`/ripgrep 无法读取，本次审计使用 Electron 自带的 Node（`ELECTRON_RUN_AS_NODE=1`）读取 asar 内容，属于只读操作。

### 1.2 插件管理机制（实测）

- 组合方式：`package.json` 的 `dsh.profile.bundles`（有序 bundle 列表）+ `cordis.patch.yml`（用户覆盖层）+ 各 bundle 自带 patch。
- 安装方式：`plugin_manager` 工具的 `install_bundle`。对绝对目录会转成 `link:<dir>` 交给 pnpm，并在成功写入依赖与 bundle 选择后由 Loader 热加载。
- 卸载/停用：`remove_bundle` / `set_bundle(enabled:false)`。
- 每个动作都需要 `danger-full-access` 或当次审批；本次安装经该机制完成，返回 `application: "applied"`。
- HMR：`desktop` profile 的 web 模板默认启用，配置与 bundle 变更可直接生效。

安装前实际存在的 bundle（来自 `plugin_manager list_bundles`）：

| bundle | 版本 | 状态 |
| --- | --- | --- |
| `@deepseek-ai/dsh-base` | 0.2.2-rc.1 | 安装自带，必需 |
| `@deepseek-ai/dsh-web-app` | 0.2.2-rc.1 | 安装自带，必需 |
| `dsh-context` | 0.79.0 | 已安装、启用 |
| `cc-safety-net` | 2.7.2 | 已安装、启用 |
| `dsh-web-search-pro` | 0.2.3 | 已安装、启用，但**安装前**即报 `incompatible-version`（peer 范围不含 0.2.2-rc.1），与本插件无关 |
| `@taxueseek/argo-dsh` | 2.10.1 | 已安装、启用 |
| `last30days-skill-cn` | 4.0.0 | 已安装、启用 |

安装前已快照 profile 的 `package.json`、`cordis.patch.yml`、`pnpm-lock.yaml` 到 `.backup/pre-install-20261104T200928/`，并记录 SHA-256。

### 1.3 Tool 注册接口（来自实际类型定义）

通过 `cordis_inspect_query` 读取 Host `Service.listService("tools")`，得到当前版本的确切签名：

```text
register(definition: ToolDefinition, options: ToolRegistrationOptions = {}): () => void
```

`ToolDefinition` 实际字段：

```text
name, description, parameters(Record<string, unknown>), deferLoading?,
output { schema: JsonSchemaNode, render(args, value): ContentBlock[], presentationMeta? },
execute(args, exec): Promise<unknown>, projectContent?, finalizeContent?,
timeoutMs?, isConcurrencySafe?(args), presentCall?, presentResult?
```

补充事实（读自 `dsh-tools` 的 README 与编译产物）：

- `defineTool()` 会把作者参数 DSL 编译成 JSON Schema，并在执行前校验，非法参数抛 `invalid arguments`。
- `output.schema` 会在 pipeline 中校验实际返回值；返回结构必须严格匹配。
- `timeoutMs` 只是声明，注册表本身不强制超时——超时必须插件自己实现。
- 取消是协作式的：`exec.signal`。
- 插件注册是 effect 归属的，卸载时注销。

### 1.4 其他相关服务

| 服务 | 用途 | 本次用法 |
| --- | --- | --- |
| `workingDirectory` | `ensure(agent)` / `defaultDirectory` / `get(session)` | 可选读取，用于解析相对路径；缺失时回落 `process.cwd()` |
| `configEditor` | 保存行配置 | 未使用：插件不在运行时改自己的配置 |

### 1.5 Creator Mode 与普通模式

- `plugin_manager` 在 Standard / Creator 预设默认启用（其 README 明确说明）；本次会话中该工具可用，并成功执行安装。
- 工具注册在 Host 全局作用域，未做 agent 级 `restrict`，因此新起的 Agent 也能看到（已用独立 subagent 实测）。

---

## 二、AnyDoc 源码审计

### 2.1 获取方式与版本

| 项 | 值 |
| --- | --- |
| 仓库 | `https://github.com/firecrawl/anydoc` |
| 本地路径 | 审计期间位于 `<temporary clone>`（独立目录，未覆盖任何既有项目）。**该克隆已在审计与测试完成后删除**，运行时不依赖它；需要复核时按下方 SHA 重新克隆即可 |
| HEAD SHA | `e7178e099b6bf9171e2c52b832cbdb4134b69112` |
| HEAD 提交时间 | 2026-10-23 17:55:34 -0500 |
| `git describe` | `v0.2.4-7-ge7178e0` |
| 最新 tag | `v0.2.4` |
| Cargo 版本 | `0.2.4` |
| 许可证 | MIT（仓库根 `LICENSE`） |

**运行时实际使用的版本**：npm 包 `@firecrawl/anydoc@0.2.4` + 平台包 `@firecrawl/anydoc-darwin-arm64@0.2.4`。

选择理由：`v0.2.4` 是官方稳定 tag，且 npm 预编译产物与该 tag 对应；HEAD 仅比 tag 多 7 个提交，其中 `node/` 与 `src/` 的差异如下（`git diff --stat v0.2.4..HEAD`）：

```text
node/README.md    |  8 +++++++-
node/anydoc.d.ts  |  6 ++++++
node/anydoc.js    | 15 ++++++++++++--
node/cli.js       | 19 +++++++++++++++--
src/shared/header.rs | 18 ++++++++++++--------
```

即 HEAD 只多了 hosted OCR 参数校验/CLI 选项与一处 header 处理，**没有改动本插件使用的 API 形状**。审计阅读的是 HEAD 源码，实测验证的是 0.2.4 二进制；两者在本插件使用的接口上一致，且所有行为结论都来自实测，不来自源码推测。

### 2.2 架构

```text
document bytes
  ├─ 格式检测（内容标记：PDF 头 / RTF 开组 / OLE 流名 / ZIP mimetype 与 [Content_Types].xml）
  ├─ 各格式 parser（doc、docx、ppt、pptx、xls、xlsx、xlsb、odt/ods/odp、rtf、epub、csv）
  │     └─ Document 统一模型（blocks / inlines / tables / notes / assets）
  │            └─ GFM serializer
  └─ PDF → pdf-inspector → Markdown（无 Document 模型）
```

源码目录：`src/formats/*`（各格式解析）、`src/model/*`（统一模型）、`src/render/*`（Markdown 序列化）、`src/package/*`（OPC/ZIP 容器）、`src/error.rs`、`node/src/*`（N-API 绑定）。

### 2.3 Node.js API（`node/index.d.ts` 实际声明）

```ts
toMarkdown(path: string): Promise<string>
toMarkdownBytes(bytes: Uint8Array, format?: Format | null): Promise<string>
toDocument(bytes: Uint8Array, format?: Format | null): Promise<Document>   // PDF 不支持
formatFromBytes(bytes: Uint8Array): Format | null
formatFromExtension(extension: string): Format | null
formatFromPath(path: string): Format | null
```

`Document` 模型：

```ts
interface Document { blocks: Block[]; notes: Note[]; assets: Asset[] }
interface Asset { id: number; mediaType: string; originPart: string; data: Buffer }
```

关键结论：

- `assets` 提供**原始字节**、MIME 与来源部件，因此资源导出可行。
- 内嵌图片在 Markdown 中只呈现 alt 文本；带外链的图片才输出 `![]()`。
- `toDocument` 对 PDF 不适用（PDF 直接产出 Markdown）。

### 2.4 错误词表（Node 侧 `error.code`）

| code | 含义 | 实测对应样本 |
| --- | --- | --- |
| `unsupported` | 未知格式或无法转换 | 构造的纯文本 `.bin`：`unsupported input: unrecognized file content and extension` |
| `needsOcr` | PDF 页面为扫描/纯图，附带 `pages` 与 `pageCount` | `pdf/handmade-scanned.pdf` → `pages=[1,2]`；`pdf/handmade-mixed.pdf` → `pages=[2]` |
| `malformed` | 结构不可用 | `malformed/truncated--errors.docx`、`empty--errors.docx` |
| `encrypted` | 加密或口令保护 | `malformed/encrypted--errors.odt` |
| `resourceLimit` | 触发解压/嵌套/节点数上限 | `abuse/zipbomb--errors.docx` 等 8 个 abuse 样本全部命中 |
| `missingPart` | 必要部件缺失 | 未构造出稳定样本，**未实测**（映射已实现并有单元覆盖）|
| `io` | 读取失败（仅 `toMarkdown`） | 传入不存在的路径 |
| `hosted` | hosted OCR 请求失败 | 本插件不触发 |

### 2.5 隐私与网络行为

`node/anydoc.js` 是唯一的 JS 包装层，实际逻辑：

```js
function sendsToHosted(error, options) {
  return error.code === 'needsOcr' && options?.ocr === 'hosted'
}
```

- 只有同时满足「需要 OCR」且「调用方显式传 `ocr: 'hosted'`」才会执行 `parseHosted()` 走 `fetch`。
- 不传 options 时，`toMarkdown` / `toMarkdownBytes` 永远不会联网。
- Rust crate 本身没有任何网络调用（README 明确：The Rust crate has no `ocr` option and never makes network calls）。

本插件因此**不传任何 options**，并在代码与测试两个层面锁定该约束。

### 2.6 原生二进制与构建

- napi-rs（`@napi-rs/cli`），预编译目标：`x86_64-apple-darwin`、`aarch64-apple-darwin`、`x86_64/aarch64-unknown-linux-{gnu,musl}`、`x86_64-pc-windows-msvc`。
- Windows 有官方 `win32-x64-msvc` 预编译产物；**本机是 macOS arm64，Windows 行为未实机验证**。
- 包内**没有任何 install/postinstall 脚本**（已检查 `@firecrawl/anydoc` 与平台包的 `package.json`），安装不需批准构建脚本。
- Node engines：`>= 20`；实测在 Node 24.21.0（Electron 44.7.0，N-API 10）下加载正常。
- 无需 Rust、Python 或其他编译环境。

### 2.7 资源保护机制（上游）

- 固定安全上限：解压比、嵌套深度、节点数量，命中即 `resourceLimit`。
- 8 个 abuse 样本（zipbomb、deepxml、deepnest、hugespan、hugerepeat、emptyrowrepeat、imagebomb）全部以 `resourceLimit` 结束，没有崩溃。
- 转换在 libuv 线程池执行，不阻塞事件循环（`toMarkdown` 为异步）。

### 2.7.1 克隆的处置

审计用克隆已按用户要求删除（工作区只保留 `dsh-anydoc`）。删除前确认：

- `git status --porcelain` 为空，未对上游做任何本地修改；
- 插件与测试代码中**没有任何**对 `vendor/` 的引用（运行时依赖来自插件自身 `node_modules/@firecrawl/anydoc`）；
- 用到的 25 个测试样本已复制到 `dsh-anydoc/test/fixtures/upstream/` 并附 `ATTRIBUTION.md`。

需要复现审计时：

```bash
git clone https://github.com/firecrawl/anydoc.git
cd anydoc && git checkout e7178e099b6bf9171e2c52b832cbdb4134b69112
```

### 2.8 测试语料

仓库自带 `tests/fixtures/`（14 个格式目录 + abuse + malformed），本次审计把其中 25 个样本复制到本项目的 `test/fixtures/upstream/` 用于可复现测试，另用 python-docx/pptx/openpyxl 生成中文与混合语料（见 `test/fixtures/generate.py`）。

---

## 三、能力分级

### A. 上游原生支持（无需插件补足）

- 14 类扩展名的解析：doc/docx/docm、ppt/pps/pot/pptx/pptm/ppsx/ppsm、xls/xlsx/xlsm/xlsb、odt/ods/odp、rtf、epub、csv、pdf（文本层）。
- 标题层级、粗斜体/删除线/行内代码、链接、列表（含嵌套与源编号）、表格（含合并单元格与表头）、引用、脚注/尾注、代码块、演讲者备注。
- 公式转 LaTeX（`$...$` 行内、`$$...$$` 块）：docx(OMML)、pptx(OMML)、odt/ods/odp(MathML)、epub(MathML)、rtf。
- 基于内容的格式检测；扩展名仅对 CSV 等无签名格式生效。
- 内嵌资源字节 + MIME + 来源部件。
- 结构化错误码与资源上限。

### B. 需要插件适配

| 需求 | 适配方式 |
| --- | --- |
| 注册为 DSH 原生 Tool | `defineTool` + `ctx.tools.register` |
| 参数校验 | 作者 schema DSL，交给 DSH 校验 |
| 结果结构 | 自定义 JSON 输出 schema + `render` 文本 |
| 完整结果落盘 | 主进程写 `.md`，`wx` 防覆盖 |
| 上下文保护 | 预览截断 + `truncated` 标记 |
| 错误语义化 | 上游 code → 稳定插件 code + 处理提示 |
| OCR 失败可读 | `NEEDS_OCR` + `pages` + 明确“本插件不启用 hosted OCR” |
| 相对路径 | 会话工作目录（`workingDirectory`）为基准 |
| 资源上限 | 文件大小/输出长度/资源字节数 |
| 超时与取消 | worker 模式真实杀进程 |

### C. 插件额外开发

- 批量转换：目录扫描、去重、并发队列、失败隔离、统计。
- 资源落盘：按 `<stem>.assets/` 归档、命名去冲突、Markdown 追加索引、不伪造图片语义。
- 能力自检：`selfTest` 用内置微型 CSV 走完整链路。
- 可追溯日志：每次转换一行摘要（不含文档内容）。

### D. 当前条件下无法保证

| 能力 | 现状 |
| --- | --- |
| 扫描版 PDF OCR | 不实现，返回 `NEEDS_OCR`；hosted OCR 被有意禁用 |
| 图片语义理解 | 只导出字节，不生成描述 |
| 复杂版式 / SmartArt / 文本框精确还原 | 上游按块模型输出，必然有损失（见 KNOWN_LIMITATIONS） |
| 加密文档解密 | 返回 `ENCRYPTED_DOCUMENT` |
| Windows 实机验证 | 本机为 macOS arm64；Windows 路径与行为**未实测** |
| 中文文本型 PDF 样本 | 未生成；PDF 路径只用英文样本验证 |
| PDF 的文档模型 | 上游不支持，PDF 只能得到 Markdown，无 assets |

---

## 四、DSH 宿主向下兼容审计（2026-11-05 追加，对应 v0.1.1）

目标：确认插件能否在更早的 DSH 线上运行，以及需要声明什么范围。

### 4.1 审计方法

- 从 npm 取各线真实发布的 `@deepseek-ai/dsh-tools`（0.2.0-rc.2 / 0.2.1-rc.5 / 0.2.2-rc.1），比对 `lib/types/*.d.ts` 的公开契约。
- 从 `@deepseek-ai/dsh-app-boot` 的 0.2.0-rc.2 与 0.2.2-rc.1 构建产物中检索 `dsh.bundle` / `bundlePatch` / `engines.dsh` 的处理位置。
- 在临时沙箱中安装对应版本，把插件 `lib/` 与 `index.js` 复制进去实跑（`test/check-compat.mjs`）。

### 4.2 结论

| 结论 | 依据 |
| --- | --- |
| 0.2.0-rc.2 起 `defineTool`、作者 DSL、`ToolDefinition`、`ToolRunContext` 与 0.2.2-rc.1 等价 | 三个版本的 `schema.d.ts` / `index.d.ts` / `contracts.d.ts` 逐行比对，仅内部 import 路径与注释措辞不同 |
| 0.2.2 新增的 `ctx.tools.register(definition, options)` 不属于必要能力 | 插件只用单参数形式，三个版本都接受 |
| `engines.dsh` 在 0.2.0 / 0.2.1 的 app-boot 中不存在 | 只在 0.2.2-rc.1 的构建产物里出现该字段解析；旧线忽略未知字段，不会因此拒绝加载 |
| `dsh.bundle` / `bundlePatch` 在三条线都存在 | 0.2.0-rc.2 与 0.2.2-rc.1 的 app-boot 构建产物均有 |
| schemastery 3.18.5 能承载现有 Config | 沙箱实跑：`Config({})` 默认值、`resolveConfig` 裁剪均通过 |
| 插件不直接 import cordis | 仅使用 `ctx.effect/on/get/logger` 等实例方法，故 cordis 4.0.x / 4.1.x 差异不进入插件代码 |

### 4.3 范围选择

采用与生态一致的“按线枚举”写法，而不是一个宽泛区间：

```text
>=0.2.0-rc.2 <0.2.1-0 || >=0.2.1-rc.2 <0.2.2-0 || >=0.2.2-rc.1 <0.2.3-0
```

理由：DSH 在 0.2.1 → 0.2.2 之间发生过 cordis 次版本破坏性变更（4.0 → 4.1），一个 `>=0.2.0 <0.3.0` 的宽区间会把未验证的 0.2.3、0.3.0 一并放进来。逐段写法让“验证过的线”与“声明支持的线”一致。

- 0.2.0 线只接受 `rc.2` 及以后：`0.2.0-rc.1`、`0.2.1-alpha.*`、`0.2.1-rc.1` 未被验证，明确排除。
- 0.2.2 线上限为 `<0.2.3-0`：`0.2.2-alpha.*` 排除，`0.2.2-rc.1` 与后续 `0.2.2` 接受。
