# 变更记录

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本遵循语义化版本。

## [0.2.1] — 2026-11-06

补全平台支持自检，修复 Windows 路径与跨平台测试问题，并加入覆盖上游全部 7 个预编译目标的持续验证。

### 新增

- `anydoc_capabilities` 增加 `platformSupport`、`platformNote`，直接报告当前 OS/CPU 的上游绑定支持状态及建议。
- 支持矩阵覆盖 macOS arm64/x64、Windows x64、Linux x64/arm64（glibc 与 musl）；Windows ARM64 等无上游绑定的平台明确提示不支持。
- 平台核验增加上游目标集漂移检查、Linux ELF 与 macOS x64 产物检查。
- CI 覆盖 Apple 芯片 Mac、Intel Mac、Windows x64、Linux x64/ARM64 glibc 与 Alpine/musl。

### 修复

- Windows 白名单路径统一使用原生 realpath，避免 DOS 8.3 短名称与长名称不一致导致正常文件被拒绝。
- 测试文档禁用 Git 换行转换，防止扫描 PDF 字节偏移损坏及错误码误判。
- 修复 Windows 动态导入路径、POSIX 大小写测试、临时目录测试与沙箱链接方式。
- 超时测试不再依赖真实文档处理耗时，验证 worker 终止及后续恢复。
- 平台产物检查按实际运行平台核验绑定，不再写死 macOS。
- 同步锁文件中的项目版本号及宿主兼容声明；保留 `private: true`，不发布 npm。

### 验证

- 七种 CI 环境全部通过：Windows x64 为 104 通过、0 失败、3 跳过；macOS arm64/x64 与 Linux x64/arm64 的 glibc/musl 环境均为 107/107。
- 全部环境的原生绑定检查及三条 DSH 线包级兼容检查均通过。[验证记录](https://github.com/kevinasworks/dsh-anydoc/actions/runs/42236379711)。

### 说明

- 解析引擎继续固定为 AnyDoc 0.2.4；文档转换仍为本地离线，不启用 OCR。
- 平台 CI 与 DSH 包级验证不等于各平台桌面界面的完整交互验收。

## [0.2.0] — 2026-11-05

以下是该版本准备时的历史状态，当前验证范围见 0.2.1。

平台兼容：在 Apple 芯片 macOS 上实机验证，并把 Windows 10+ x64 的代码、打包与安装路径全部落实。

### 新增

- `lib/platform.js`：平台规则以纯函数实现（显式注入 `path` 实现与 `win32` 标记），使 Windows 分支可在 macOS 上单测。
- `test/platform.test.mjs`（7 项）：UNC 与扩展长度前缀、大小写不敏感/跨盘包含判定、保留设备名、NTFS 冒号、长路径告警、读写错误映射。
- `test/check-platforms.mjs`：核验两个平台的预编译产物——本机 Mach-O arm64、下载 npm 上的 Windows PE x64。
- `PLATFORM_SUPPORT.md`：支持矩阵、验证证据、Windows 验收清单与故障排查。
- `.github/workflows/platform-ci.yml`：macOS 14（Apple silicon）+ windows-latest 的双平台 CI，推送到 GitHub 后即可自动补齐 Windows 实机验证（当时尚未关联远端，后续已启用并扩展）。
- `test/run-tests.mjs`：跨平台测试入口，自己展开文件列表，不依赖 shell 的 glob 展开（cmd.exe 不展开 `test/*.test.mjs`），`npm test` 在 Windows 上同样可用。
- `npm run check:platforms` 脚本。

### 变更

- **Windows 加固**：
  - `\\?\UNC\server\share` 前缀正确还原（此前会剥成 `UNC\server\share`）。
  - win32 下文件名中的 `:` 替换为 `_`（避免写成 NTFS 数据流）；保留设备名（`CON`/`NUL`/`COM1` 等）加前导 `_`。
  - 输出路径超过 240 字符时给出 MAX_PATH 警告（不拒绝）。
  - `EBUSY` / `EPERM` 映射为 `PERMISSION_DENIED` 并说明“文件被其他程序占用”；`ENOSPC`/`EROFS`/`ENAMETOOLONG` 映射为对应的输出错误。
- **原生绑定加载失败**的错误信息现在包含 `platform/arch` 与修复指引；worker 模式也带上同一提示；win32+arm64 明确说明上游无产物。
- 资源索引中的相对路径统一用 `/`，Windows 下 Markdown 不再出现反斜杠。
- 3 个依赖符号链接/`chmod` 的用例在 Windows 上显式跳过并注明原因；`check-compat` / `check-platforms` 在 Windows 上用 `npm.cmd` + shell 调用 npm（Node 无法直接 spawn `.cmd`）。
- 版本号 0.1.1 → 0.2.0；`files` 增加 `PLATFORM_SUPPORT.md`。

### 发布准备（2026-11-06，未发布）

- 新增 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 重写：按实际分发的文件逐项列出版本、来源、许可证、原版权声明与许可原文位置；修正了此前过期的 peer 版本约束（`dsh-tools` 三段范围、`schemastery` `^3.18.5`）。
- 新增 `licenses/anydoc-LICENSE.txt`：`firecrawl/anydoc` 在提交 `e7178e0…` 的 MIT 许可证原文，逐字节保留（SHA-256 `03a9e765…`）；配套 `licenses/README.md` 记录来源与校验值。npm 包本身不带 LICENSE 文件，故以仓库原文为准。
- `LICENSE` 的版权行确定为 **`Copyright (c) 2026 Kevin Zheng`**（由项目所有者确认的公开署名）；`package.json` 增加 `author` 字段。
- 新增 `.gitignore`：排除 `node_modules/`、`.backup/`（本机 profile 快照）、`.audit/`（审计证据）、`*.tgz` 与系统噪声。
- 公开文档清理：移除本机个人路径与用户名，统一为 `$DSH_HOME`、`/path/to/...`、`~/Documents/...`；去掉与本插件无关的环境备注。
- `package.json` 的 `files` 增加 `licenses/*` 与 `PUBLISHING.md`，确保安装包携带必需许可材料。
- 新增 [PUBLISHING.md](PUBLISHING.md)：发布形态、已执行检查、GitHub 元数据建议、待确认事项与发布步骤。
- 验证：`npm pack` 产物 29 个文件，解包确认含 `LICENSE`、`THIRD_PARTY_NOTICES.md`、`licenses/`；在隔离目录安装该 tgz 后成功注册三个工具并完成一次真实 docx 转换。
- 补充验证 macOS x64 依赖链：在 Apple 芯片上用 x64 Node v24.22.2（Rosetta）安装并运行，装出 `anydoc.darwin-x64.node`（Mach-O x86_64），docx/xlsx 转换与自检均通过；`test/check-platforms.mjs` 同步增加 `darwin-x64` 产物核验。Intel 实机与 x64 Electron 仍未验证。

### 验证

- macOS arm64：106 项测试全绿；真实 DSH Tool Call 通过；本机二进制为 Mach-O 64 arm64（7,007,312 字节）；仅依赖安装后实跑转换成功。
- Windows x64：产物为 PE x64（8,275,456 字节）；`npm install --os=win32 --cpu=x64` 只解析出 `anydoc-win32-x64-msvc`；**未实机运行**。
- Windows ARM：`--cpu=arm64` 不装任何平台产物，插件按预期报 `NATIVE_UNAVAILABLE`。

## [0.1.1] — 2026-11-05

向下兼容：让插件在更早的 DSH 线上也能加载与运行，而不只是当前安装的 0.2.2-rc.1。

### 新增

- `test/check-compat.mjs` + `test/compat/run-harness.mjs`：可重复的包级兼容性验证。为每条目标线在临时目录安装该线的 `@deepseek-ai/dsh-tools`，复制插件的 `lib/` 与 `index.js` 进去，实际验证：
  - 配置 schema 在 schemastery 3.18.5 / 3.19.0 上都能加载与裁剪；
  - `defineTool` 能把作者 DSL 编译成相同的参数/输出 JSON Schema；
  - 非法参数被拒绝、能力自检通过、真实 docx 转换成功、渲染仍为一个 text block；
  - 用替身 Cordis 上下文调用 `apply()`，三个工具都能注册。
- `npm run check:compat` 与 `npm run check:updates` 脚本。

### 变更

- `engines.dsh` 由 `>=0.2.2-rc.1 <0.3.0` 扩展为三段：`>=0.2.0-rc.2 <0.2.1-0 || >=0.2.1-rc.2 <0.2.2-0 || >=0.2.2-rc.1 <0.2.3-0`。
- `@deepseek-ai/dsh-tools` 的 peer 范围同步为三段；`@deepseek-ai/schemastery` 由 `^3.19.0` 放宽到 `^3.18.5`（0.2.0 / 0.2.1 线携带 3.18.x）。
- `dsh.compatibility.dshReleases` 增加 `0.2.0-rc.2`、`0.2.1-rc.5`，保留 `0.2.2-rc.1`。
- 版本号 0.1.0 → 0.1.1。

### 未变更（有意为之）

- `@firecrawl/anydoc` 仍精确锁定 `0.2.4`：向下兼容针对 DSH 宿主，不放开解析引擎版本。
- 运行时行为、工具签名、输出结构、限额与安全边界均未改动。

## [0.1.0] — 2026-11-04

首个可用版本：在本机 DSH 0.2.2-rc.1 中完成开发、安装与真实 Tool Call 验收。

### 新增

- **原生插件骨架**
  - `package.json` 声明 `dsh.bundle.patch`、`engines.dsh`、optional peer 依赖。
  - `cordis.patch.yml` 注册 `id: anydoc` 行。
  - `index.js` 实现 `apply(ctx, config)`，`inject: ['tools']`，导出 schemastery `Config`。
  - `locale/en.json`、`locale/zh.json` 与原创 `icon.svg`（Plugin Manager 显示用）。
- **三个原生 Tool**
  - `anydoc_convert`：单文件转换，结构化结果 + 预览截断 + 完整 Markdown 落盘。
  - `anydoc_batch_convert`：批量转换，支持文件/目录、递归开关、并发上限、失败隔离、成功/失败/跳过统计。
  - `anydoc_capabilities`：只读健康检查，`selfTest` 用内置微型 CSV 验证完整链路。
- **执行引擎**
  - worker 模式：`child_process.fork` 进程池，超时与取消以 `SIGKILL` 真正终止；崩溃以 `ENGINE_CRASHED` 上抛且不重试。
  - in-process 模式：同进程加载绑定；超时明确返回 `TIMEOUT_NOT_CANCELLED`。
  - 两种模式共用 `lib/convert-core.js`，输出逐字节一致。
  - worker 启动失败时自动一次性回退到 in-process。
- **内容与资源**
  - 支持 `.doc/.docx/.docm`、`.ppt/.pps/.pot/.pptx/.pptm/.ppsx/.ppsm`、`.xls/.xlsx/.xlsm/.xlsb`、`.odt/.ods/.odp`、`.rtf`、`.epub`、`.csv`、`.pdf`（文本层）。
  - 基于内容的格式检测，扩展名只作提示；CSV 走扩展名并在 `formatSource` 标注。
  - 可选资源导出到 `<stem>.assets/`，Markdown 末尾生成资源索引，不伪造图像描述。
- **安全与资源限制**
  - 路径：`~` 展开、绝对化、realpath、凭据目录拒绝、`allowedRoots` 白名单、Windows 盘符在 POSIX 上显式拒绝。
  - 输出：单段名清洗、`isInside` 复核、`wx` 打开防竞态、默认不覆盖、自动 `-N` 后缀。
  - 限额：单文件 100 MiB、单文件 60 s、批量并发 2、单批 50、预览 8000 字符、输出 5,000,000 字符、资源 64 MiB，全部可配且有硬边界。
  - 隐私：从不向 AnyDoc 传 `ocr: 'hosted'`；不读 API Key；不联网；日志不含文档内容。
- **错误语义**
  - 上游 `unsupported/needsOcr/malformed/encrypted/resourceLimit/missingPart/io` 映射为稳定插件错误码。
  - `NEEDS_OCR` 保留页码，给出“本地不启用 OCR”的处理提示。
- **文档**：README、ARCHITECTURE、SOURCE_AUDIT、CONFIGURATION、TEST_REPORT、KNOWN_LIMITATIONS、CHANGELOG、THIRD_PARTY_NOTICES。
- **维护工具**：`test/check-updates.mjs` 只读比对 DSH 与 AnyDoc 的本机/上游版本，判断是否需要升级或重新适配。
- **变更复核**（2026-11-05）：DSH `0.2.2-rc.1` 与 AnyDoc `0.2.4` 均为当前最新（GitHub tag、npm dist-tag、桌面端 nightly feed 一致），插件无需升级或重新适配。
- **测试**
  - 98 个自动化用例（`node --test`），覆盖格式内容、异常、路径安全、批量、隐私、工具定义与插件挂载。
  - `test/fixtures/generate.py` 生成中文/中英混合/长文档样本；`test/fixtures/upstream/` 收录 25 个上游 MIT 样本并附归属说明。
  - `test/fallback.test.mjs` 以故障注入验证 worker 启动失败时的 in-process 回退。
  - `test/bench.mjs` 提供本机性能实测。

### 修复（开发过程中）

- `sanitizeSegment` 对非全局正则误用 `replaceAll` 导致抛错。
- 引擎 `dispose()` 后仍可继续转换（`activeMode` 被改写掩盖释放状态）。
- `exec.signal` 在 worker 启动窗口内中止会丢失（补 `signal.aborted` 检查）。
- in-process 超时用例因样本文档过快而不稳定（新增 3,000 段 `zh-heavy.docx`）。
- 资源导出断言错误地假设所有资源都是图片（样本含 OLE 对象）。
- 批量 `success` 语义过严（目录中的非文档文件使整批判失败）。
- 中文表格测试样本未写入单元格文本。
- 失败渲染缺少针对性的处理提示。
- 每次调用传入的 `previewChars` 未做上限约束（现限制在 200,000 字符内）。
- 批量 `concurrency` 传入非数值时会导致工作协程数为 0（现已回落配置默认值）。
- 输出文件名改用调用方给出的文件名而不是符号链接解析后的目标名。

### 已知问题

见 [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md)。要点：不做 OCR；PPT（旧格式）表格退化为文本；PDF 无文档模型与资源；Windows 与真实重启后的持久化未实机验证。
