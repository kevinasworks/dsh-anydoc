# dsh-anydoc

基于 [Firecrawl AnyDoc](https://github.com/firecrawl/anydoc) 的 DeepSeek Harness **原生插件**，把本地办公文档、电子书、CSV 与文本型 PDF 解析为 GitHub-Flavored Markdown，并注册为 DSH 模型可直接调用的原生 Tool。

- 插件名：`dsh-anydoc`
- 版本：`0.2.0`
- 仓库：本仓库即插件的包根目录
- AnyDoc 运行时版本：`@firecrawl/anydoc` **0.2.4**（npm 预编译 N-API 绑定）
- 许可证：MIT

## 与 Firecrawl AnyDoc 的关系

- 解析能力**全部来自上游** [Firecrawl AnyDoc](https://github.com/firecrawl/anydoc)（MIT，版权 Sideguide Technologies Inc.），本项目**不复制、不修改、不重新编译**其源码，也不分发其原生二进制；`.node` 文件由使用者在安装时通过 npm 按平台获取。
- 本项目新增的是 **DSH 集成层**：原生 Tool 定义与参数/输出 schema、进程隔离与超时、路径与资源安全、批量调度、资源导出、能力自检、配置与文档。
- 本项目是**独立社区项目**，不是 Firecrawl、DeepSeek 或任何机构的官方插件，未获得其授权、认证或背书。
- 本项目自身代码以 MIT 发布；第三方材料、版权声明与完整许可原文见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 与 [licenses/](licenses/)。

## 它解决什么问题

DSH 的模型可以直接读文本文件，但 `.docx` / `.xlsx` / `.pptx` / `.pdf` 这类二进制容器里的文字、表格、公式和备注，需要先转换成文本。本插件把 AnyDoc 的本地 Rust 解析引擎接入 DSH 的工具注册表，于是：

```text
用户提问 → 模型调用 anydoc_convert → 插件本地解析 → Markdown 写入文件 + 预览返回 → 模型基于内容继续分析
```

全过程**不联网、不上传文档**。AnyDoc 唯一的联网路径是显式传入 `ocr: 'hosted'`，本插件从不传这个参数。

## 三个原生工具

| 工具 | 作用 |
| --- | --- |
| `anydoc_convert` | 单文件转换。返回结构化结果（`success`、`detectedFormat`、`outputPath`、`markdownPreview`、`truncated`、`warnings`、`errorCode` 等），完整 Markdown 写入文件。 |
| `anydoc_batch_convert` | 批量转换。支持文件列表或单目录（默认不递归）、并发上限、失败隔离，返回成功/失败/跳过统计。 |
| `anydoc_capabilities` | 只读健康检查。返回插件与 AnyDoc 版本、原生绑定状态、当前平台及 `platformSupport`（上游是否提供该平台的绑定）、当前引擎、支持格式、OCR 策略、资源限制；`selfTest: true` 时用内置微型 CSV 走完整链路，**不读取任何用户文档**。 |

## 支持的格式

以 AnyDoc 0.2.4 官方支持表为准，本插件已逐项实测：

| 类别 | 扩展名 |
| --- | --- |
| Word | `.doc` `.docx` `.docm` |
| PowerPoint | `.ppt` `.pps` `.pot` `.pptx` `.pptm` `.ppsx` `.ppsm` |
| Excel | `.xls` `.xlsx` `.xlsm` `.xlsb` |
| OpenDocument | `.odt` `.ods` `.odp` |
| 其他 | `.rtf` `.epub` `.csv` `.pdf`（文本层） |

注意：

- 格式由**文件内容**判定，扩展名只是提示。把 `report.docx` 改名成 `report.bin` 仍然能转换，插件会明确给出“扩展名不在支持表内”的警告。
- `.csv` 没有内容签名，靠扩展名识别，因此 `formatSource` 会是 `extension` 而不是 `content`。
- 扫描版 PDF 会返回 `NEEDS_OCR` 与页码，**不会**自动上传或启用 hosted OCR。

## 安装

插件以 DSH 官方 Bundle 方式安装，不修改 DSH 核心源码，也不手改 profile 文件。

### 通过 npm 包名安装（推荐）

在 DSH 的「插件」→「添加插件」中输入：

```text
dsh-anydoc
```

如需固定版本，输入 `dsh-anydoc@0.2.1`。npm 包地址：[dsh-anydoc](https://www.npmjs.com/package/dsh-anydoc)。首次发布后，中国大陆镜像可能尚未同步，可先选择 npm 官方源。

从 npm 安装后，DSH 支持在插件详情的「版本」区块检查新版，也可刷新插件列表，发现兼容版本后点击「更新」。这是 DSH 的版本检查功能，不是插件向用户主动推送通知；是否需要重启由宿主提示。

### 现有 GitHub 安装用户迁移

GitHub、压缩包或本地目录安装不属于 DSH 的 npm 版本更新范围。迁移前记录插件配置，卸载旧安装，再用上面的 npm 包名安装一次并核对配置；以后使用 DSH 的更新按钮，无需每次手动卸载重装。

### 通过 GitHub 安装

在「添加插件」中也可以输入完整地址：

```text
https://github.com/kevinasworks/dsh-anydoc
```

此方式获取 GitHub 源码，但不会显示 npm 安装所具有的版本更新区块。推荐希望跟随正式版本的用户选择 npm 包名安装。

安装时需要能够访问所选源以获取插件、AnyDoc 依赖及当前平台的原生绑定。仓库与 npm 包均不包含 `node_modules/`；文档转换本身仍为本地离线执行。

### 从本地目录安装

适合已下载或克隆源码的用户。先在插件目录安装运行依赖：

```bash
cd /path/to/dsh-anydoc
npm install --omit=dev
```

随后在 DSH 中让 Agent 调用 `plugin_manager`，将 `target` 换成插件目录的实际绝对路径：

```json
{ "action": "install_bundle", "target": "/path/to/dsh-anydoc" }
```

`target` 也接受 `link:` 绝对路径。安装过程由 `plugin_manager` 完成：写入 profile 的 `package.json` 依赖与 `dsh.profile.bundles`，链接本目录，并由 Loader 热加载。Windows 用户请使用实际的 Windows 绝对路径，在 JSON 中将反斜杠写为 `\\`。

> 说明：`@deepseek-ai/dsh-tools` 与 `@deepseek-ai/schemastery` 声明为 **optional peerDependency**。DSH 的 runtime resolution 会把这两个名字解析到当前安装的 DSH 内部包，插件目录里不需要、也不应该放它们的副本。`package.json` 中的 `devDependencies` 仅用于在本机跑自动化测试，运行时不使用。

安装后确认：

```text
anydoc_capabilities → {"selfTest": true}
```

应看到 `native binding: ok`、`engine: worker`、`self test: passed`。

## 使用示例

单文件：

```json
{ "sourcePath": "~/Documents/季度报告.docx", "previewChars": 12000 }
```

返回：

```text
Converted /Users/me/Documents/季度报告.docx -> /Users/me/.dsh/anydoc-output/季度报告.md
format: docx (content) · 13,902 chars · 37,767 input bytes · 41 ms · engine: worker
--- markdown preview ---
# 季度技术评审报告 …
```

大文件只返回截断预览，并在预览末尾说明“已显示 N/M 字符，完整内容见 outputPath”，模型不会被超长正文撑爆上下文。

批量：

```json
{ "directory": "~/Documents/投标资料", "recursive": true, "concurrency": 2, "exportAssets": true }
```

带图片导出：

```json
{ "sourcePath": "report.docx", "exportAssets": true }
```

图片等内嵌资源会写到 `<输出目录>/<文件名>.assets/`，并在 Markdown 末尾追加 `## Exported assets` 索引。**只导出原始字节，不做图像语义分析**，插件不会伪造图片描述。

## 平台支持

支持范围严格等于上游 `@firecrawl/anydoc@0.2.4` 的 7 个预编译目标；上游没有产物的一律不支持。

**macOS（Apple 芯片）是作者日常使用的主要平台**，已有真实 DSH Tool Call 验证。其余受支持目标也已纳入持续集成，当前平台运行结果如下（Node.js 22）：

| 平台 | 架构 | 验证状态 |
| --- | --- | --- |
| **macOS（Apple 芯片）** | arm64 | 本地真实 DSH Tool Call 已验证；原生 CI **107/107 通过** |
| **macOS（Intel）** | x64 | Intel 原生 CI **107/107 通过**；另有 Rosetta 运行记录 |
| **Windows x64**（目标 Windows 10/11） | x64 | Windows Server runner 实际运行：**104 通过、0 失败、3 项既有跳过**；Windows 10/11 DSH 桌面交互尚未完整验收 |
| **Linux（glibc）** | x64 / arm64 | 两种架构的原生 Ubuntu CI 均 **107/107 通过** |
| **Linux（musl）** | x64 / arm64 | 对应原生架构上的 Alpine 容器均 **107/107 通过** |
| Windows on ARM 原生进程 | arm64 | **不支持**：上游无 ARM64 绑定；自检会报告 `platformSupport: unsupported` 并给出建议 |

[本版本完整 CI 记录](https://github.com/kevinasworks/dsh-anydoc/actions/runs/42236379711)。所有环境均通过原生绑定核验及 DSH `0.2.0-rc.2`、`0.2.1-rc.5`、`0.2.2-rc.1` 包级兼容检查，覆盖真实文档转换、自检、进程隔离、超时与恢复。**CI 运行验证不替代完整 DSH 桌面界面验收**；Intel Mac 的 x64 Electron 宿主、Windows 10/11 的交互、文件占用和 SMB 场景仍需单独验证。

从本地源码安装时，每台机器各自安装依赖，原生绑定不可跨平台共用：

```bash
cd <插件目录>
npm install --omit=dev
```

如需运行仓库内的验证脚本，先安装开发依赖：

```bash
npm ci
node test/check-platforms.mjs   # 核验本机绑定、上游目标集与各平台产物
```

详见 [平台支持与验证边界](PLATFORM_SUPPORT.md)。

## 兼容性

插件声明并实测了三条 DSH 线（`engines.dsh`）：

```text
>=0.2.0-rc.2 <0.2.1-0 || >=0.2.1-rc.2 <0.2.2-0 || >=0.2.2-rc.1 <0.2.3-0
```

| DSH 线 | 状态 | 该线携带的依赖 |
| --- | --- | --- |
| `0.2.0-rc.2` | 已验证 | dsh-tools 0.2.0-rc.2 · schemastery 3.18.5 · cordis 4.0.5 |
| `0.2.1-rc.2` ~ `rc.5` | 已验证（实跑 rc.5） | dsh-tools 0.2.1-rc.5 · schemastery 3.18.5 · cordis 4.0.5 |
| `0.2.2-rc.1` ~ `0.2.2` | 已验证（实跑 rc.1） | dsh-tools 0.2.2-rc.1 · schemastery 3.19.0 · cordis 4.1.0 |

不在范围内的版本会被 DSH 的准入检查拒绝：`0.2.0-rc.1`、`0.2.1-alpha.*`、`0.2.1-rc.1`、`0.2.2-alpha.*`、`0.2.3+`、`0.3.x`。范围边界已用 `semver@7` 逐版本核对。

随时可以重跑兼容性验证：

```bash
node test/check-compat.mjs
```

它会在临时目录为每条线装好对应的 `@deepseek-ai/dsh-tools`（连带其 schemastery / cordis），把插件的 `lib/` 与 `index.js` 复制进去，然后实际执行：编译三个工具的参数/输出 schema、校验非法参数、跑一次能力自检、转换一份真实 docx、并用替身 Cordis 上下文调用一次 `apply()` 挂载插件。任何一条线失败都会以非零退出码结束。

> 说明：这是**包级兼容性验证**（在该线真实发布的宿主依赖上运行插件代码），不是把旧版 DSH 桌面端整体启动一遍。详见 [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md)。

`@firecrawl/anydoc` 仍然精确锁定 `0.2.4`——向下兼容针对的是 DSH 宿主，不放开解析引擎版本。

## 默认值与限制

| 项 | 默认 | 说明 |
| --- | --- | --- |
| 单文件大小 | 100 MiB | 超过直接拒绝，不进入解析引擎 |
| 单文件超时 | 60 s | worker 模式下**真正杀掉进程**，不是只让 Promise 超时 |
| 批量并发 | 2 | 可在调用时指定，上限 8 |
| 单批文件数 | 50 | 超出部分标注未处理，不会静默截断 |
| 内联预览 | 8000 字符 | 可调用时覆盖 |
| 输出总长 | 5,000,000 字符 | 超过则拒绝写入并报 `OUTPUT_TOO_LARGE` |
| 资源导出上限 | 64 MiB | 超出部分跳过并告警 |
| 输出目录 | `~/.dsh/anydoc-output` | 可用 `outputDir` 参数或 `outputRoot` 配置覆盖 |

完整配置项见 [CONFIGURATION.md](CONFIGURATION.md)。

## 隐私与数据流

```text
本地文件 → 插件（进程内或子进程）→ @firecrawl/anydoc → Rust 解析 → Markdown → 本地文件
```

- 不自动上传文件，不调用 Firecrawl Parse，不发送遥测。
- 不写文档内容到日志：日志只记录源路径、格式、字符数、耗时、输出路径。
- `npm install` 只是获取依赖（公网流量），与文档内容传输是两件事。
- 证据见 [TEST_REPORT.md](TEST_REPORT.md)：静态扫描 + 在禁用 `fetch` 的进程内/子进程内转换成功。

## 卸载与回滚

停用（保留安装，随时可恢复）：

```json
{ "action": "set_bundle", "target": "dsh-anydoc", "enabled": false }
```

卸载：

```json
{ "action": "remove_bundle", "target": "dsh-anydoc" }
```

`remove_bundle` 会从 profile 的 `package.json` 移除依赖与 bundle 选择，不会触碰其他插件。

回滚到安装前状态：安装前的 profile 文件快照保存在 `.backup/pre-install-<时间戳>/`（`package.json`、`cordis.patch.yml`、`pnpm-lock.yaml`），并附有 SHA-256 校验值。若卸载异常，可用它们对照恢复。

插件不会删除用户输出文档；`~/.dsh/anydoc-output` 需自行清理。

## 文档索引

| 文件 | 内容 |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 架构、模块边界、数据流、DSH 接口用法 |
| [SOURCE_AUDIT.md](SOURCE_AUDIT.md) | 环境审计、AnyDoc 源码审计、能力分级 A/B/C/D |
| [CONFIGURATION.md](CONFIGURATION.md) | 配置项、默认值、边界与权限 |
| [PLATFORM_SUPPORT.md](PLATFORM_SUPPORT.md) | macOS / Windows / Linux 支持矩阵、验证证据、验收清单 |
| [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) | 第三方组件、版本、许可证与随附许可原文 |
| [licenses/](licenses/) | 随分发的第三方许可证原文（AnyDoc，MIT） |
| [PUBLISHING.md](PUBLISHING.md) | 发布范围、已执行检查、GitHub 元数据建议与发布结论 |
| [TEST_REPORT.md](TEST_REPORT.md) | 测试环境、用例、结果、性能与证据 |
| [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) | 已知限制、OCR 现状、未验证项 |
| [CHANGELOG.md](CHANGELOG.md) | 版本记录 |
| [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) | 第三方依赖与许可证 |

## 许可证

- 本项目代码：**MIT**，版权归 **Kevin Zheng**，见 [LICENSE](LICENSE)。
- 上游 AnyDoc 与随仓库分发的测试语料：MIT，版权归 `Sideguide Technologies Inc.`，原文见 [licenses/anydoc-LICENSE.txt](licenses/anydoc-LICENSE.txt)。
- 组件清单、版本、来源与使用方式见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

> 发布状态与检查结论记录在 [PUBLISHING.md](PUBLISHING.md)。

## 运行测试

```bash
cd /path/to/dsh-anydoc
npm test                    # 107 个自动化用例
node test/bench.mjs         # 本机实测性能
node test/check-updates.mjs   # 是否需要升级 / 重新适配
node test/check-platforms.mjs # 本机绑定、上游目标集与各平台产物是否就绪
node test/check-compat.mjs  # 每条支持的 DSH 线是否仍然兼容
```

### 检查更新

`node test/check-updates.mjs` 会只读比对四项事实并给出结论（退出码 0=无需升级，1=有更新，2=无法判定）：

| 检查项 | 比对对象 |
| --- | --- |
| DSH（GitHub 最新 tag） | 本机 `dsh --version` |
| DSH（桌面端 nightly feed） | 同上，读官方更新源 `nightly-mac.yml` |
| `@firecrawl/anydoc`（npm latest） | 插件 `package.json` 锁定值 |
| `@firecrawl/anydoc`（仓库最新 tag） | 同上 |

它不会安装、下载或修改任何东西；网络不可用时对应项标为 `unreachable`。
