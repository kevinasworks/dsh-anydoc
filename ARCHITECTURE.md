# 架构说明

## 总览

```text
┌─────────────────────────────────────────────────────────────────────┐
│ DeepSeek Harness 0.2.2-rc.1（Electron 44.7.0 / Node 24.21.0）        │
│                                                                     │
│  Agent 模型 ──tool call──► ctx.tools Registry ──execute──► dsh-anydoc│
│        ▲                                              │             │
│        │              render(value) → ContentBlock     │             │
│        └───────────────────────────────────────────────┘             │
└─────────────────────────────────────────────────────────────────────┘
                            │
        ┌───────────────────┴────────────────────┐
        │ lib/service.js（编排：路径校验 / 限额 / │
        │   输出写入 / 批量调度 / 能力报告）      │
        └───────────────────┬────────────────────┘
                            │ engine.convert({file, wantAssets})
        ┌───────────────────┴────────────────────┐
        │ lib/engine.js                          │
        │   worker 模式（默认）│ inprocess 模式   │
        └───────┬─────────────┴──────────┬───────┘
                │ child_process.fork      │ 同进程 import
        ┌───────▼─────────────┐   ┌───────▼─────────────┐
        │ lib/worker-entry.js │   │ lib/convert-core.js │
        │ lib/convert-core.js │   │ @firecrawl/anydoc   │
        │ @firecrawl/anydoc   │   │ N-API → Rust 解析器 │
        └───────┬─────────────┘   └───────┬─────────────┘
                └───────────┬───────────────┘
                     Markdown + assets + format
```

## 分层职责

| 文件 | 职责 | 关键约束 |
| --- | --- | --- |
| `index.js` | 插件入口：`apply(ctx, config)`，解析配置、构造 Engine、注册三个 Tool | 只依赖 `tools` 服务；`workingDirectory` 为可选服务 |
| `lib/config.js` | schemastery `Config` 声明 + `resolveConfig()` 运行时裁剪 | 所有数值都有上下界；非法值按边界归类而不是崩溃 |
| `lib/tools.js` | `defineTool` 定义：名称、描述、参数 schema、输出 schema、渲染 | 输出 schema 与实际返回**逐字段一致**（DSH 会校验） |
| `lib/service.js` | 业务编排：校验输入 → 调引擎 → 写输出 → 组装结果 | 预期失败返回 `success:false`，不抛异常打断回合 |
| `lib/engine.js` | 执行引擎：worker 进程池 + in-process 回退 | 超时/取消在 worker 模式是**真实终止进程** |
| `lib/worker-entry.js` | 子进程侧协议实现 | 只做解析；不写文件、不做路径判断 |
| `lib/convert-core.js` | 两种模式共享的转换核心 | 从不向 AnyDoc 传 options，杜绝 hosted OCR |
| `lib/paths.js` | 文件系统安全边界 | realpath 解析后再判定；输出名不可逃逸 |
| `lib/platform.js` | 平台规则与上游目标矩阵 | 纯函数、可注入 `path`，使 Windows 分支可在 macOS 上单测；`UPSTREAM_PREBUILT_TARGETS` 是支持范围的唯一事实来源 |
| `lib/formats.js` | 支持格式表 | 仅用于提示与目录扫描过滤，不替代内容检测 |
| `lib/errors.js` | 错误码词表与模型可读提示 | 上游 code → 插件 code 的映射集中在此 |

## DSH 插件接口（按本机实际版本核对）

以下均来自 `0.2.2-rc.1` 的实际类型定义与运行行为，不是记忆推断：

| 项 | 实际用法 |
| --- | --- |
| 入口 | `export function apply(ctx, config)`；`index.js` 由 `package.json` 的 `main`/`exports` 指向 |
| 依赖声明 | `export const inject = ['tools']`（Cordis 中 inject 项是硬依赖） |
| 配置 schema | `export const Config = z.object({...})`（`@deepseek-ai/schemastery`）；行配置在激活时校验；`Config.listConfigs` 能读到完整 JSON Schema |
| 工具注册 | `ctx.tools.register(defineTool({...}))`，返回 disposer；本插件统一包在 `ctx.effect(() => ctx.tools.register(tool))` 中，随插件卸载注销 |
| 参数 schema | 作者 DSL：`{ 名称: { type, required: true, description } }`，`defineTool` 编译为 JSON Schema 并在执行前校验；非法参数抛 `invalid arguments` |
| 输出 | `output: { schema, render }`；返回值必须满足 `output.schema`（DSH 的 `pipeline` 会校验），`render` 产出 `[{ type: 'text', text }]` |
| 超时 | `timeoutMs` 对注册表是**声明性**的，本插件不依赖它，自己在引擎内计时 |
| 取消 | `execute(args, exec)` 的 `exec.signal`，协作式取消；worker 模式会真正杀死子进程 |
| 并发 | `isConcurrencySafe`：`anydoc_convert` / `anydoc_capabilities` 为 `true`，批量转换 `false` |
| Bundle | `package.json` 的 `dsh.bundle.patch` 指向 `cordis.patch.yml`，其中 `insert` 一行 `id: anydoc` / `name: dsh-anydoc` |
| 版本准入 | `engines.dsh: ">=0.2.2-rc.1 <0.3.0"`；声明后 `peerDependencies` 不再参与准入判定 |
| 依赖解析 | optional peer `@deepseek-ai/dsh-tools`、`@deepseek-ai/schemastery` 由 DSH runtime resolution 映射到安装内的同版本包；`@firecrawl/anydoc` 走插件自身 `node_modules` |
| 工作目录 | 可选服务 `ctx.workingDirectory.ensure(exec.agent)`；相对路径按会话工作目录解析，取不到时回落 `process.cwd()` |

## 执行引擎

### worker 模式（默认）

- `child_process.fork(lib/worker-entry.js)`，`ELECTRON_RUN_AS_NODE=1`，JSON 序列化 IPC。
- 进程池大小 `workerPoolSize`（默认 2），一次请求一个 worker，空闲复用。
- 每次转换独立计时 `timeoutMs`：超时即 `SIGKILL` 并返回 `TIMEOUT`；`exec.signal` 中止同样杀进程并返回 `CANCELLED`。
- 子进程崩溃 / `exit` 时，挂起请求以 `ENGINE_CRASHED` / `ENGINE_FAILED` 结束并附带 stderr 尾部（截断 4 KiB）。
- 只有 **worker 启动失败**（`WORKER_START_FAILED`）才会回退到 in-process 一次；转换中途崩溃不重试，避免重复工作。

为什么默认用子进程：DSH Host 是 GUI 主进程，原生解析崩溃或失控分配不应拖垮整个 Harness；同时“杀进程”才配得上“超时已取消”的说法。

### in-process 模式

- 直接在 Host 进程加载绑定，省掉进程间开销。
- 超时只能放弃等待，返回 `TIMEOUT_NOT_CANCELLED`，并明确说明原生调用可能仍在运行——不谎称已取消。
- 用于诊断，或在 `/Volumes/…` 等环境下 `fork` 受限时的兜底。

### 两种模式的一致性

`lib/convert-core.js` 是唯一实现。测试 `worker and in-process modes produce byte-identical Markdown` 对同一份 docx 断言两份输出逐字节相同。

## 数据流（单文件）

1. `resolveBaseDir` 取会话工作目录。
2. `checkInputFile`：解析 `~` → 绝对化 → realpath → 凭据路径拒绝 → `allowedRoots` → `stat`（存在/常规文件/非空/大小）→ 可读性。
3. `prepareOutputDirectory`：同样走 realpath 与 `allowedRoots`，然后建目录、验证可写。
4. 引擎转换：子进程读取字节 → `formatFromBytes` / `formatFromPath` → `toMarkdownBytes`（必要时再 `toDocument` 取 assets）。
5. 主进程写文件：`allocateOutputPath` 选空闲名，`writeFileSafe` 以 `wx` 打开，杜绝竞态覆盖。
6. 组装结果：预览截断到 `previewChars`，`truncated` 标明是否截断。
7. `output.render` 生成模型可见文本。

## 数据流（批量）

- 输入可以是文件、目录或两者混合；目录扫描按名字排序，默认不递归。
- 扫描时只收支持扩展名的文件，其余记为 `skipped` 并说明原因（这不算失败，也不隐藏）。
- 去重后按 `batchMaxFiles` 截断，超出部分明确告警。
- 用固定数量 worker 协程消费队列；每个文件独立 try/catch，单个失败不影响其他文件。
- 取消时已开始的条目会结束，未开始的记为 `skipped/CANCELLED`。

## 安全边界

| 风险 | 处理 |
| --- | --- |
| 路径穿越 | `path.resolve` + 单段名清洗 + `isInside` 复核；输出名不允许出现分隔符 |
| 符号链接 / Junction 逃逸 | 先 `realpath` 再判定 `allowedRoots`；目录递归用 realpath 集合防环 |
| 凭据读取 | `.ssh/`、`.gnupg/`、`.aws/credentials`、`Library/Keychains/`、`.dsh/credentials*`、`.netrc` 直接拒绝 |
| 覆盖写 | 默认不覆盖；`writeFileSafe` 用 `wx`，EEXIST 时改选新名 |
| Windows 路径 | 检测盘符/UNC；在 POSIX 主机上明确报错而不是当作文件名 |
| 巨型文档 | 大小上限 + 上游 `resourceLimit` + 超时杀进程 + 输出长度上限 |
| 内存 | worker 进程隔离；assets 走 base64 传输并受 `maxAssetBytes` 约束 |
| 隐私 | 不传 `ocr: 'hosted'`；静态扫描 + 断网测试双重验证 |

本插件运行在 Host 进程内，拥有进程自身的文件权限——这是 DSH 对已安装 Host 插件的既有模型（`plugin_manager` 文档亦如此说明）。因此上述边界是插件自律实现的，而不是操作系统沙箱。

## 生命周期

- 激活：`apply()` → 解析配置 → `ctx.effect(() => () => engine.dispose())` → 注册 3 个工具 → 记录一行启动日志。
- 卸载/禁用：effect 依次释放 → 工具注销、worker 全部 `SIGKILL`。
- 配置变更：字段非 `.volatile()`，按 DSH 语义重启该插件条目，不重启整个 Host。
- 升级：重新 `install_bundle` 覆盖安装后按 DSH 提示重启；不会自动追随上游新版本。

## 为什么不是 Skill / MCP

- Shell 里 `npx` 临时下载再解析，既慢又引入不受控执行链，且模型需要自己拼命令；
- MCP Server 需要额外进程与协议层，而 DSH 原生 Tool 已能满足全部需求（本机 `ctx.tools.register` 工作正常）；
- 结论：原生 Plugin 是当前版本下最短、最稳的路径。
