# 平台支持

本文件记录 `v0.2.1` 当前的平台运行结果、安装方式与尚待验收的桌面场景。

以 `v0.2.1` 提交 `73ddccd9236ad75176c61ec4880fd42eadf0a36f` 的 [完整 CI](https://github.com/kevinasworks/dsh-anydoc/actions/runs/42236379711) 为准：七种环境全部通过。Windows x64 为 **104 通过、0 失败、3 项既有平台条件跳过**；macOS arm64/x64、Linux x64/arm64 的 glibc 与 musl 环境均为 **107/107 通过**。所有环境的原生绑定检查及三条 DSH 版本线包级兼容检查均通过。

## 1. 支持矩阵

macOS Apple 芯片是作者日常使用的平台；其他受支持目标也已纳入 CI。支持目标来自 `@firecrawl/anydoc@0.2.4` 的 7 个预编译包，以 `lib/platform.js` 的 `UPSTREAM_PREBUILT_TARGETS` 为准；上游没有产物的组合不支持。

| 平台 | 架构 / libc | 当前验证状态 | 运行环境 |
| --- | --- | --- | --- |
| macOS Apple 芯片 | arm64 | 本地 DSH Tool Call 通过；CI 107/107 | `macos-15`，ARM64 Node.js 22 |
| macOS Intel | x64 | 原生 CI 107/107；另有 Rosetta 记录 | `macos-15-intel`，x64 Node.js 22 |
| Windows x64 | x64 | CI 104 通过、0 失败、3 跳过 | `windows-latest`，Windows Server x64，Node.js 22 |
| Linux glibc | x64 | 原生 CI 107/107 | `ubuntu-24.04`，glibc 2.39，Node.js 22 |
| Linux glibc | arm64 | 原生 CI 107/107 | `ubuntu-24.04-arm`，glibc 2.39，Node.js 22 |
| Linux musl | x64 | 原生架构容器 107/107 | x64 runner 上的 `node:22-alpine` |
| Linux musl | arm64 | 原生架构容器 107/107 | ARM64 runner 上的 `node:22-alpine` |
| Windows ARM64 原生进程 | arm64 | 不支持，上游无绑定 | x64 DSH 模拟运行的替代路径未验证 |

以上验证不依赖跨 CPU 模拟。Windows Server CI 不能直接证明 Windows 10/11 的全部桌面行为，Node.js 插件运行也不等同于 x64 Electron 宿主验收。Node.js 声明下限为 20；本次七平台 CI 使用 22，并未覆盖所有 Node.js 版本。

## 2. 安装（每个平台各自执行一次）

推荐按 [README](README.md#安装) 使用 GitHub 地址安装。以下为本地目录安装方式：**原生绑定不会跨平台共用**，每台机器应安装与当前 OS/CPU/libc 匹配的依赖：

```bash
cd <插件目录>
npm install --omit=dev     # 只装运行依赖，会按当前 OS/CPU 选平台包
```

Windows（PowerShell / cmd 同理）：

```powershell
cd C:\path\to\dsh-anydoc
npm install --omit=dev
```

然后确认：

```json
{ "action": "install_bundle", "target": "C:\\path\\to\\dsh-anydoc" }
```

```text
anydoc_capabilities  →  {"selfTest": true}
```

预期看到 `platform: win32`、`arch: x64`、`native binding: ok`、`self test: passed`。

`npm install` 只是下载依赖（公网流量），与文档内容传输无关；解析仍然完全本地。

## 3. 平台相关实现（代码层）

平台差异集中在 `lib/platform.js`（纯函数，可注入 `path` 实现与平台标记，因此能在 macOS 上测 Windows 规则）：

| 关注点 | 实现 |
| --- | --- |
| 路径分隔符 | 统一用 `node:path`，扩展名解析同时接受 `/` 与 `\` |
| 盘符与 UNC | `isWindowsAbsolute` 识别 `C:\`、`C:/`、`\\server\share`；在 POSIX 主机上遇到 Windows 绝对路径会显式报错而不是当成文件名 |
| `\\?\` 前缀 | `stripWindowsPrefix` 处理 `\\?\C:\` 与 `\\?\UNC\server\share` |
| 大小写 | Windows 的包含判定交给 `path.win32.relative`（大小写不敏感、跨盘返回绝对路径→判定为“不在内部”） |
| 保留设备名 | `CON`、`PRN`、`AUX`、`NUL`、`COM1-9`、`LPT1-9` 在 Windows 上加前导 `_` |
| NTFS 数据流 | 名称中的 `:` 在 Windows 上替换为 `_`（否则会写成 `file:stream`） |
| 尾部点/空格 | 全平台剥离（Windows 本来就不允许） |
| 长路径 | 超过 240 字符时在 `warnings` 中提示 MAX_PATH 风险（不拒绝） |
| 文件占用 | `EBUSY`/`EPERM` 映射为 `PERMISSION_DENIED`（读写两侧）并说明“被其他程序占用” |
| 符号链接 / Junction | 先 `realpath` 再判定 `allowedRoots`；目录递归用 realpath 集合防环，Junction 成环不会无限递归 |
| 子进程 | `child_process.fork` 传绝对路径与 `ELECTRON_RUN_AS_NODE=1`，路径含空格或中文不需要 shell 转义 |
| 终止 | 超时/取消用 `SIGKILL`（Windows 上映射到 `TerminateProcess`） |
| Unicode 文件名 | NFC 规范化，中文/全角括号/空格原样保留 |
| Markdown 输出 | 资源索引里的相对路径统一用 `/`，避免 Windows 反斜杠污染 Markdown |

## 4. 已验证到什么程度

| 验证项 | macOS arm64 | 其他六种受支持环境 |
| --- | --- | --- |
| 自动化测试 | 107/107 | Intel Mac 与四种 Linux 均 107/107；Windows 104 通过、3 项既有跳过 |
| 真实文档转换、自检、批量、进程隔离及超时恢复 | 本地与 CI 通过 | CI 通过 |
| 原生绑定加载与架构检查 | Mach-O arm64 | Mach-O x86_64、PE x64、四种 ELF 均通过 |
| 平台支持矩阵 | 单测通过 | 单测通过 |
| 三条 DSH 版本线包级兼容 | 通过 | 全部通过；使用真实 dsh-tools 包与替身 Cordis 上下文 |
| 完整 DSH 桌面端 Tool Call | 本地已有记录 | 尚未验收；CI 不启动完整 DSH Desktop |
| Windows 文件占用、深层路径实际读写、杀毒软件、SMB | 不适用 | 尚未完成桌面场景验收；路径规则单测已通过 |

Windows 的三项跳过是 POSIX 专属盘符拒绝测试及两个需要 Windows 符号链接权限的用例，没有新增跳过。CI 安装包含开发依赖；生产依赖单独安装、完整桌面宿主解析等场景应与包级验证分开看待。

### 4.1 macOS x64（Rosetta）实测记录

2026-11-06 在 Apple 芯片 macOS 上做了真实运行，覆盖 x64 依赖链：

| 步骤 | 结果 |
| --- | --- |
| 下载 `node-v24.22.2-darwin-x64` 并用 `arch -x86_64` 启动 | ✅ `node v24.22.2 · arch x64 · platform darwin`（Rosetta 转译） |
| 用该 x64 Node 的 npm 安装本插件 tgz | ✅ 自动选出 `@firecrawl/anydoc-darwin-x64`，未装 arm64 包 |
| 校验已安装二进制 | ✅ `anydoc.darwin-x64.node`，Mach-O 64 **x86_64**（cputype `0x01000007`） |
| 用 x64 Node 加载插件并调用 `apply()` | ✅ 注册 3 个工具 |
| 真实转换（x64 进程内） | ✅ `docx-text.docx` → 1,295 字符；`zh-table.xlsx` → 410 字符 |
| `anydoc_capabilities` 自检 | ✅ `platform darwin · arch x64 · node v24.22.2 · anydoc 0.2.4 · selfTest passed` |

**当前状态**：上述 Rosetta 记录是补充证据。`v0.2.1` 已在 `macos-15-intel` 的 Intel x64 原生 runner 上完成 107/107 测试、绑定核验与三条 DSH 线包级检查。尚未验收的是完整 x64 Electron / DSH Desktop 宿主，不再把 Intel 平台运行列为未验证。

### 4.2 Windows on ARM：为什么是“不支持”，以及能怎么办

上游 `@firecrawl/anydoc@0.2.4` 的 napi targets 只有 `x86_64-pc-windows-msvc`，**没有 `aarch64-pc-windows-msvc`**。实测（`npm install --os=win32 --cpu=arm64`）只会装到 `anydoc` 本体，不带任何平台绑定，加载时报 `Cannot find native binding`。

插件对此的处理：

- `lib/platform.js` 的 `describePlatformSupport('win32','arm64')` 返回 `status: 'unsupported'`，并给出替代方案（改用 x64 版 DSH，由 Windows 的 x64 模拟运行；或换 x64 机器）。
- `anydoc_capabilities` 增加 `platformSupport` / `platformNote` 两个字段，未转换任何文档就能看出这个平台是否被上游支持。
- 绑定加载失败的错误信息会附带同一段提示，不再是只报 “Cannot find native binding”。

**能怎么办**：Windows 11 ARM 可以用 x64 模拟运行 x64 应用。装上 **x64 版 DSH Desktop** 后，宿主进程是 x64，npm 会安装 `anydoc-win32-x64-msvc`，理论上可使用上游 x64 产物（该替代路径尚未运行验证）。这属于更换宿主架构，不是插件能自动完成的事；本机没有 Windows ARM 设备，**未实测**。

### 4.3 Linux：四种原生运行环境均已通过

| 产物 | 架构 | 大小 | 结果 |
| --- | --- | --- | --- |
| `anydoc.linux-x64-gnu.node` | ELF x86_64 | 8,189,088 字节 | ✅ 架构正确 |
| `anydoc.linux-arm64-gnu.node` | ELF arm64 | 7,222,168 字节 | ✅ 架构正确 |
| `anydoc.linux-x64-musl.node` | ELF x86_64 | 8,206,864 字节 | ✅ 架构正确 |
| `anydoc.linux-arm64-musl.node` | ELF arm64 | 7,230,808 字节 | ✅ 架构正确 |

代码层面没有 Linux 特化路径：路径处理用 `node:path` 的 posix 分支，`child_process.fork`、`realpath`、`os.tmpdir()` 都是跨平台 API，`describeLongPathRisk` 只在 `win32` 生效。`npm install` 会按 libc（glibc / musl）自动选择 gnu 或 musl 包。

**运行验证**：Linux x64/arm64 的 glibc 环境在原生 Ubuntu runner 上执行，musl 环境在对应原生架构的 Alpine 容器中执行；四种环境均完成 107/107 测试、真实转换、自检、worker 隔离与恢复，以及三条 DSH 版本线包级兼容检查。完整 Linux DSH Desktop 交互仍未验收。


## 5. Windows 最终验收清单

第 2–4 项已在 Windows Server CI 中通过；第 1 项为生产依赖独立安装的本地检查。Windows 10/11 桌面环境仍可按此清单验收。运行仓库测试需先执行 `npm ci` 安装开发依赖；仅使用插件可执行 `npm install --omit=dev`。

1. `npm install --omit=dev` → 应出现 `@firecrawl/anydoc-win32-x64-msvc`
2. `node test/check-platforms.mjs` → 本地二进制检查应为 `PE x64`
3. `npm test` → 预期 **104 通过 + 3 跳过**。跳过项为 POSIX 专属盘符拒绝测试，以及两个需要 Windows 符号链接权限的用例；其余断言保持启用。
4. `node test/check-compat.mjs` → 三条 DSH 线 PASS
5. 在 DSH 中：`anydoc_capabilities {selfTest:true}` → `native binding: ok · self test: passed`
6. 真实转换一个 `.docx` 与一个 `.xlsx`，检查输出路径与内容
7. 批量转换一个含中文文件名、含空格路径的目录
8. 打开/占用一个 docx 再转换它 → 应返回 `PERMISSION_DENIED`（文件被占用），而不是崩溃
9. 转换到深层目录（路径 > 240 字符）→ 应出现 MAX_PATH 警告
10. 关闭/启用插件（`plugin_manager set_bundle`）→ 工具随之消失/恢复

## 6. 自动化验收

`.github/workflows/platform-ci.yml` 已启用，`main`/`master` 推送、PR 与手动触发均可运行：

- 原生 runner：`macos-15`、`macos-15-intel`、`windows-latest`、`ubuntu-24.04`、`ubuntu-24.04-arm`。
- musl：在对应 x64/ARM64 runner 上运行 `node:22-alpine` 容器。
- 每种环境执行依赖安装、完整测试、平台产物核验及三条 DSH 线包级兼容检查。

`v0.2.1` 的七种环境均已通过：[CI 记录](https://github.com/kevinasworks/dsh-anydoc/actions/runs/42236379711)。

## 7. 故障排查

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `NATIVE_UNAVAILABLE ... Cannot find native binding` | 插件目录是从别的平台复制来的，或 Windows on ARM | 在目标机器上 `npm install --omit=dev`；Windows ARM 无解（上游无产物） |
| `PERMISSION_DENIED ... 被其他程序占用` | 文件在 Word/Excel 里打开，或被杀毒软件锁定 | 关闭文件后重试 |
| `warning: ... MAX_PATH` | 输出路径过长 | 换更短的 `outputDir`，或启用 Windows 长路径支持 |
| `PATH_FORBIDDEN` | 命中凭据目录黑名单 | 属预期行为，改用其他路径 |
| 工具不出现 | bundle 未启用或被准入拒绝 | `plugin_manager list_bundles` 查看 `enabled`/`error` |

## 8. 与 DSH 版本的关系

平台支持与 DSH 版本支持是两件事：

- 平台：看本文档的七种受支持目标及桌面验收边界
- DSH 版本：见 [README 的兼容性一节](README.md#兼容性)，支持 `0.2.0-rc.2`、`0.2.1-rc.2~rc.5`、`0.2.2-rc.1~0.2.2`

两者需要同时满足。
