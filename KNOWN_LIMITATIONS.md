# 已知限制

> **2026-11-06 Windows CI 更新**：修复前的 8 项失败均已通过。Windows x64 在 GitHub runner 上为 **103 通过、0 失败、3 项既有平台条件跳过**；macOS arm64 为 **106/106 通过**。两端的平台产物检查及三条 DSH 版本线的包级兼容检查全部通过。下面关于 Windows“未运行”及 CI“休眠”的描述属于早期记录；Windows 10/11 桌面端交互、文件占用和 SMB 等场景仍需单独验收。[验证记录](https://github.com/kevinasworks/dsh-anydoc/actions/runs/42230021943)

本文件记录**实际观察到**的限制，分三类：上游能力、本插件设计取舍、尚未验证。不把未验证项写成“支持”。

---

## 一、OCR：当前未启用（设计选择）

AnyDoc 本地不做 OCR。任何需要 OCR 的 PDF 会以 `NEEDS_OCR` 结束，并带上 1 起算的页码：

```text
error: NEEDS_OCR — all 2 pages need OCR
pages needing OCR: 1, 2
hint: The PDF pages listed are scanned or image-only. AnyDoc does no OCR and this plugin keeps
conversion local, so no remote OCR is attempted. …
```

明确的行为边界：

- **不会**自动上传文件。
- **不会**自动启用 Firecrawl Parse / hosted OCR。
- **不会**把失败的扫描件当成成功返回空内容。
- 只有文本层完整的 PDF 才能转换；混合型 PDF 只要有一页需要 OCR 也会整体失败（上游行为，`handmade-mixed.pdf` 实测 `pages=[2]`）。

将来若接入本地 OCR，扩展点是 `lib/convert-core.js`：在 `NEEDS_OCR` 分支接本地 OCR 实现即可，无需改动工具层与路径/限额层。本阶段不实现。

---

## 二、上游解析能力限制

| 限制 | 说明 | 证据 |
| --- | --- | --- |
| PPT（旧二进制）表格退化为文本 | `.ppt` 中的表格不输出 Markdown 表格，而是逐行文本（`Region`/`Total`/`North`/`42`）。`.pptx` 正常。 | 实测 `ppt-pres.ppt` |
| PDF 没有文档模型 | `toDocument` 对 PDF 不可用，因此 PDF 无法导出 assets，Markdown 中也没有页码标记。 | 上游 `index.d.ts` |
| 内嵌图片只留 alt 文本 | Markdown 中嵌入图片渲染为 alt 文本（如 `image.png`、`图 1：…`），图片字节需另行导出。 | 实测 |
| 外链图片与内嵌图片表现不同 | 带 URL 的图片输出标准 `![]()`；内嵌图片不是。 | 上游文档 |
| 复杂版式不保证还原 | 文本框、SmartArt、浮动定位按块模型处理，位置与层叠关系会丢失；实测文本框内容被拆成独立段落（`Text box:` / `after the box.` / `Inside the text box.`）。 | 实测 `docx-text.docx` |
| 列表缩进依赖源文档的 numbering 定义 | 层级来自 `numbering.xml`；用某些模板生成的 “List Bullet 2” 可能不带层级，输出为同级列表。上游 fixture 中带完整编号定义的文档缩进正常。 | 实测对比 |
| 公式支持按格式而定 | OMML（docx/pptx）、MathML（odt/ods/odp/epub）、RTF 公式可转 LaTeX；其他形式（如图片化的公式、MathType 二进制对象）不转。 | 上游文档 + 实测 |
| 图表（chart）不解析数据 | 图表作为对象，不输出系列数据或图片。 | 上游范围 |
| 加密文档不解密 | 返回 `ENCRYPTED_DOCUMENT`。 | 实测 |
| 扩展名只在无签名格式上起作用 | `.csv` 靠扩展名；其余按内容判定。把 `.docx` 改名 `.bin` 仍能转，但会给出扩展名警告。 | 实测 |
| `.xls` / `.xlsb` 归一为 `xlsx` | `detectedFormat` 报 `xlsx`，这是上游 `Format` 枚举按解析器归类的行为，不是误判。 | 实测 |

---

## 三、本插件的设计取舍

| 取舍 | 原因 | 影响 |
| --- | --- | --- |
| 默认 worker 子进程 | 崩溃隔离 + 超时可真正终止 | 首次调用有约 40–280 ms 冷启动；小文件每次多几毫秒 IPC |
| 默认不覆盖输出 | 防止误删用户文件 | 同名文件会产生 `-1`、`-2` 后缀，需要 `overwrite:true` 才覆盖 |
| 默认不递归 | 防止误扫整个磁盘 | 目录扫描只看一层，需要时显式 `recursive:true` |
| 目录扫描只收已知扩展名 | 避免把 `.txt`/`.jpg` 塞进解析器 | 显式列出的文件不受此限，仍会尝试 |
| 单批上限 50（可配） | 防止一次调用拖垮会话 | 超出部分在 `warnings` 中说明，未处理的文件不计入 `total` |
| 资源导出只写字节，不生成描述 | 不伪造解析结果 | 想理解图片内容需要另用视觉工具 |
| 预览默认 8000 字符 | 保护模型上下文 | 完整内容总在 `outputPath`，`truncated`/渲染文本都会提示 |
| `allowedRoots` 默认空 | 个人自用，模型给的路径即授权 | 需要强隔离时请显式配置白名单 |
| 不自动升级 AnyDoc | 避免未经兼容验证的行为变化 | 升级需手动改 `package.json` 并重装后跑完整测试 |
| 相对路径以会话工作目录为准 | 符合用户直觉 | 服务缺失时回落 `process.cwd()`，极端情况下可能与会话目录不同 |

---

## 四、尚未验证

| 项 | 状态 | 原因 |
| --- | --- | --- |
| ~~真实进程重启后的持久化~~ | **PASS** | 已于 DSH 重启后实测：工具仍可用、自检通过、加载的是最新代码（见 TEST_REPORT 第八节） |
| **Windows 实机运行** | NOT_TESTED | 本机为 macOS arm64。Windows 一侧完成：平台代码审计与加固、win32 规则单测（`path.win32`）、`win32-x64-msvc` 产物核验（PE x64）、`npm install --os=win32 --cpu=x64` 安装选择验证。未在 Windows 上执行测试与 Tool Call，详见 [PLATFORM_SUPPORT.md](PLATFORM_SUPPORT.md) 的验收清单 |
| 上游未发布的目标（Windows ARM、Windows ia32、Linux riscv64 等） | LIMITATION（按上游范围不做） | 支持范围以 `lib/platform.js` 的 `UPSTREAM_PREBUILT_TARGETS` 为准，超出即 `unsupported`。|
| Windows on ARM（arm64） | LIMITATION | 上游 AnyDoc 只发布 `win32-x64-msvc`，没有 arm64 绑定，属于上游能力边界。插件会报 `platformSupport: unsupported` 与 `NATIVE_UNAVAILABLE`，并提示改用 x64 版 DSH（由 Windows x64 模拟运行）或 x64 机器；**未在 Windows ARM 实机验证** |
| Linux（x64 / arm64，glibc 与 musl） | NOT_TESTED | 上游四个 Linux 绑定均已下载核验为 ELF（架构正确），代码无 Linux 特化路径；但本机无容器运行时或 Linux VM，**未在 Linux 上跑测试或真实转换** |
| macOS Intel（x64） | NOT_TESTED（依赖链已测） | 已在 Apple 芯片上用 Rosetta 跑通 x64 链路：x64 Node v24.22.2 + `anydoc.darwin-x64.node`，docx/xlsx 转换与自检通过。未在 Intel 硬件与 x64 Electron 宿主上验证 |
| Junction / 网络共享路径逃逸（Windows） | NOT_TESTED | 判定走 `realpath` 后比对 `allowedRoots`，目录递归用 realpath 集合防环；macOS 符号链接已实测，Windows Junction 与 SMB 路径未实机执行 |
| 中文文本型 PDF | NOT_TESTED | 未生成中文 PDF 样本；PDF 只用英文样本验证 |
| `MISSING_PART` 错误码 | NOT_TESTED | 未构造出稳定触发样本（映射已实现） |
| Native Binding 加载失败的真实场景 | NOT_TESTED | 未破坏安装去制造故障；`probe()` 的降级路径已实现 |
| 数据库/大型表格的极端规模 | NOT_TESTED | 只测到 `zh-heavy.docx`（294,801 字符输出） |
| 多个大文件同时转换的内存峰值 | NOT_TESTED | 未做 RSS 级测量：进程隔离提供了上限保护，但没有量化数据 |
| **旧版 DSH 桌面端整体启动** | NOT_TESTED | 向下兼容采用的是**包级验证**：在每条线真实发布的 `@deepseek-ai/dsh-tools`（连带 schemastery / cordis）上执行插件的 `lib/` 与 `index.js`，并用替身上下文调用 `apply()`。没有把 0.2.0-rc.2 / 0.2.1 的桌面端真的启动一遍——本机只装了 0.2.2-rc.1 的 Desktop |
| 0.2.1-rc.2 ~ rc.4 | NOT_TESTED | 只实跑了 rc.5；同线小版本之间的 dsh-tools 声明与 rc.5 一致（版本范围内），但未逐个执行 |
| cordis 4.0.4（0.2.0 线原生版本） | NOT_TESTED | 沙箱里 npm 解析到 4.0.5（同属 4.0.x）。插件不直接 import cordis，只用 `ctx` 上的方法，风险低但未精确复现 |
| 其他 DSH 版本 | NOT_TESTED | `engines.dsh` 精确限定三段范围；范围外的版本会被准入检查拒绝。DSH 桌面端走 nightly 通道，升级后请先跑 `node test/check-updates.mjs`、`node test/check-compat.mjs`、`npm test` 与一次真实 Tool Call 再判定可用 |
| 剔除 `devDependencies` 后的冷启动加载 | NOT_TESTED | 运行时已证明可用；但同一进程内 ESM 模块被缓存，无法在不重启的前提下验证“移除本地 DSH 副本后靠 runtime resolution 解析 peer”。设计上 peer 为 optional，由 DSH 按名字映射到安装内同版本包 |

---

## 五、环境相关注意事项

- **`link:` 安装与磁盘可用性**：插件通过 `link:` 指向本地目录安装。若该目录所在磁盘不可用（例如外接卷未挂载），DSH 启动时会跳过该 bundle 并报告，不影响其他插件；恢复后可用。
- **输出目录**：默认 `$DSH_HOME/anydoc-output`，插件不会自动清理。
- **`private: true`**：本包是个人自用插件，未发布到 npm；`link:` 安装不需要发布。
