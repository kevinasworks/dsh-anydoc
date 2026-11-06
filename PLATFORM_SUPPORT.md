# 平台支持

> **2026-11-06 Windows CI 更新**：修复前的 8 项失败均已通过。Windows x64 在 GitHub runner 上为 **103 通过、0 失败、3 项既有平台条件跳过**；macOS arm64 为 **106/106 通过**。两端的平台产物检查及三条 DSH 版本线的包级兼容检查全部通过。下面关于 Windows“未运行”及 CI“休眠”的描述属于早期记录；Windows 10/11 桌面端交互、文件占用和 SMB 等场景仍需单独验收。[验证记录](https://github.com/kevinasworks/dsh-anydoc/actions/runs/42230021943)

本文件说明 `dsh-anydoc` 在 Windows 与 macOS 上的支持范围、安装方式、已验证到什么程度，以及在 Windows 上做最终验收的清单。

## 1. 支持矩阵

**macOS（Apple 芯片）是唯一的主要平台**：作者自用、全部测试与真实 Tool Call 都在这里跑，任何改动都必须先保证它不回归；其余平台只做到“跟随上游产物”，不投入日常验证。

**支持范围严格等于上游 `@firecrawl/anydoc@0.2.4` 发布的 7 个预编译目标**（`darwin-arm64`、`darwin-x64`、`win32-x64-msvc`、`linux-x64-gnu`、`linux-arm64-gnu`、`linux-x64-musl`、`linux-arm64-musl`）。上游没有产物的一律不做——本插件不自建、不分发 AnyDoc 二进制。这个清单以 `lib/platform.js` 的 `UPSTREAM_PREBUILT_TARGETS` 为唯一事实来源，`node test/check-platforms.mjs` 会在上游增删目标时报警。

| 平台 | 架构 | 状态 | 依据 |
| --- | --- | --- | --- |
| **macOS（Apple 芯片）** | `arm64` | **主要平台：完整支持，已实机运行，日常验证** | 本机 `darwin/arm64` 上 107 项测试全绿；真实 DSH Tool Call 通过；原生绑定为 Mach-O 64 **arm64**（7,007,312 字节） |
| macOS（Rosetta / Intel） | `x64` | **x64 依赖链已实测（Rosetta），未在 Intel 实机验证** | 在 Apple 芯片上用 x64 Node v24.22.2 经 Rosetta 运行：装出 `anydoc.darwin-x64.node`（Mach-O **x86_64**），docx/xlsx 转换与自检均通过（见 4.1） |
| **Windows 10 / 11** | `x64` | **代码与打包已就绪，未实机运行** | 上游发布 `anydoc.win32-x64-msvc.node`（PE **x64**，8,275,456 字节，已下载核验）；平台相关代码路径有 win32 规则单测 |
| Windows on ARM | `arm64` | **不做（上游无产物）** | 上游 AnyDoc 只发布 `win32-x64-msvc`，没有 arm64 绑定。`anydoc_capabilities` 会直接报 `platformSupport: unsupported` 并给出替代方案；`NATIVE_UNAVAILABLE` 错误里也带同样提示（见 4.2） |
| Linux | `x64` / `arm64` | **产物齐备并已核验，未在 Linux 实机运行** | 上游发布 `linux-{x64,arm64}-{gnu,musl}` 四个绑定；本机逐个下载核验为 **ELF**（x86_64 / arm64，8.1–8.2 MB 与 7.2 MB）；代码无平台特化路径（见 4.3） |

> “支持”指插件能在该平台加载并工作；“已验证”指真的在该平台跑过。两者在本文件中始终分开写。

## 2. 安装（每个平台各自执行一次）

插件通过 `link:` 安装，**原生绑定不会跨平台共用**：macOS 目录里只有 `anydoc-darwin-arm64`，Windows 需要它自己的 `.node`。因此在每台机器上：

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

| 验证项 | 本机（macOS arm64） | 其他平台 |
| --- | --- | --- |
| 自动化测试（107 项） | ✅ 实跑 107/107 | ❌ 未执行（Windows 上预期 104 通过 + 3 跳过；Linux 未跑） |
| 真实 DSH Tool Call（转换/批量/自检） | ✅ 实跑 | ❌ 未执行 |
| 原生绑定架构 | ✅ Mach-O arm64 | ✅ 已下载核验：darwin x86_64（Mach-O）、win32 x64（PE）、linux x64/arm64（ELF，glibc 与 musl 各一） |
| `npm install --omit=dev` 选对平台包 | ✅ 实跑 | ✅ Windows 用 `--os=win32 --cpu=x64` 模拟；x64 用真实 x64 Node 实测（见 4.1） |
| 平台路径规则单测 | ✅ posix + `path.win32` 双分支 | ✅ 同左 |
| 进程隔离、超时杀进程 | ✅ 实跑 | ❌ 未执行 |
| `npm test` 跨平台入口 | ✅ `node test/run-tests.mjs`（不依赖 shell 展开 glob） | 同一实现 |
| 平台支持矩阵（`platformSupport`） | ✅ 单测覆盖 darwin/win32/linux/未知组合 | ✅ 同一实现 |
| 长路径 / 文件占用 / 杀毒软件干扰 | 不适用 | ❌ 未执行 |
| macOS x64 依赖链（Rosetta） | ✅ 实跑：x64 Node + `anydoc.darwin-x64.node`，docx/xlsx 转换与自检通过（见 4.1） | — |

**没有** Windows 机器或 Windows CI 可用，所以 Windows 一侧完成的是：代码审计 + win32 规则单测 + 打包产物核验 + 安装选择验证。**不宣称 Windows 已实机运行。**

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

**边界**：Rosetta 转译 ≠ Intel 硬件。该测试证明了 `darwin-x64` 原生绑定与插件代码在 x64 进程中可用，但没有覆盖 Intel Mac 的 CPU/系统版本差异，也没有覆盖 **x64 Electron** 宿主（DSH 桌面端在 Intel Mac 上会以 x64 运行）。因此状态是“依赖链已实测、Intel 实机未验证”，不写成“已验证”。

### 4.2 Windows on ARM：为什么是“不支持”，以及能怎么办

上游 `@firecrawl/anydoc@0.2.4` 的 napi targets 只有 `x86_64-pc-windows-msvc`，**没有 `aarch64-pc-windows-msvc`**。实测（`npm install --os=win32 --cpu=arm64`）只会装到 `anydoc` 本体，不带任何平台绑定，加载时报 `Cannot find native binding`。

插件对此的处理：

- `lib/platform.js` 的 `describePlatformSupport('win32','arm64')` 返回 `status: 'unsupported'`，并给出替代方案（改用 x64 版 DSH，由 Windows 的 x64 模拟运行；或换 x64 机器）。
- `anydoc_capabilities` 增加 `platformSupport` / `platformNote` 两个字段，未转换任何文档就能看出这个平台是否被上游支持。
- 绑定加载失败的错误信息会附带同一段提示，不再是只报 “Cannot find native binding”。

**能怎么办**：Windows 11 ARM 可以用 x64 模拟运行 x64 应用。装上 **x64 版 DSH Desktop** 后，宿主进程是 x64，npm 会安装 `anydoc-win32-x64-msvc`，整条链路可用（这是上游产物支持的路径）。这属于更换宿主架构，不是插件能自动完成的事；本机没有 Windows ARM 设备，**未实测**。

### 4.3 Linux：产物齐备，未实机运行

| 产物 | 架构 | 大小 | 结果 |
| --- | --- | --- | --- |
| `anydoc.linux-x64-gnu.node` | ELF x86_64 | 8,189,088 字节 | ✅ 架构正确 |
| `anydoc.linux-arm64-gnu.node` | ELF arm64 | 7,222,168 字节 | ✅ 架构正确 |
| `anydoc.linux-x64-musl.node` | ELF x86_64 | 8,206,864 字节 | ✅ 架构正确 |
| `anydoc.linux-arm64-musl.node` | ELF arm64 | 7,230,808 字节 | ✅ 架构正确 |

代码层面没有 Linux 特化路径：路径处理用 `node:path` 的 posix 分支，`child_process.fork`、`realpath`、`os.tmpdir()` 都是跨平台 API，`describeLongPathRisk` 只在 `win32` 生效。`npm install` 会按 libc（glibc / musl）自动选择 gnu 或 musl 包。

**未验证**：没有 Linux 运行环境（本机无容器运行时、无 Linux VM），因此没有跑测试、没有真实转换。上面是产物与代码层面的核验，不是运行验证。


## 5. Windows 最终验收清单

在 Windows 机器上依次执行，任一失败请把输出贴回来：

1. `npm install --omit=dev` → 应出现 `@firecrawl/anydoc-win32-x64-msvc`
2. `node test/check-platforms.mjs` → 本地二进制检查应为 `PE x64`
3. `npm test` → 期望 **103 通过 + 3 跳过**。跳过的是 3 个需要创建符号链接/改权限的用例：Windows 上创建符号链接需要开发者模式或管理员权限，而 chmod 不是 Windows 的权限模型；测试里已按平台显式 `skip` 并写明原因。其余用例用 `os.tmpdir()` 与平台 `path` 推导期望值，不写死 POSIX 路径。
4. `node test/check-compat.mjs` → 三条 DSH 线 PASS
5. 在 DSH 中：`anydoc_capabilities {selfTest:true}` → `native binding: ok · self test: passed`
6. 真实转换一个 `.docx` 与一个 `.xlsx`，检查输出路径与内容
7. 批量转换一个含中文文件名、含空格路径的目录
8. 打开/占用一个 docx 再转换它 → 应返回 `PERMISSION_DENIED`（文件被占用），而不是崩溃
9. 转换到深层目录（路径 > 240 字符）→ 应出现 MAX_PATH 警告
10. 关闭/启用插件（`plugin_manager set_bundle`）→ 工具随之消失/恢复

## 6. 自动化验收（可选）

目录里带了一份 `.github/workflows/platform-ci.yml`：把整个目录推到 GitHub 后，它会在 `macos-14`（Apple silicon）与 `windows-latest`（x64）上各跑一遍 `npm install` → `npm test` → `node test/check-platforms.mjs` → `node test/check-compat.mjs`。这是补上“Windows 实机验证”最省事的方式——不需要你手上有 Windows 机器。

目前该文件处于休眠状态：本目录尚未关联任何 Git 远端。

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

- 平台：看本文档（Windows 10+ x64 / Apple silicon macOS）
- DSH 版本：见 [README 的兼容性一节](README.md#兼容性)，支持 `0.2.0-rc.2`、`0.2.1-rc.2~rc.5`、`0.2.2-rc.1~0.2.2`

两者需要同时满足。
