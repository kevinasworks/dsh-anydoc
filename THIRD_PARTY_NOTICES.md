# 第三方声明

本文件说明 `dsh-anydoc` 实际使用、复制或分发的第三方材料。所有结论都基于本仓库锁定的版本与实际文件，而非上游 README 的宣传内容。

- 本项目自身许可：**MIT**，版权归 **Kevin Zheng**，见 [LICENSE](LICENSE)。
- 本项目**不是** Firecrawl、DeepSeek 或任何机构的官方项目，未获得其授权、认证或背书。
- 本仓库**不包含** AnyDoc 的源码或其原生二进制；`.node` 文件由使用者安装时通过 npm 获取。

---

## 1. 运行依赖：`@firecrawl/anydoc`

| 项 | 值 |
| --- | --- |
| 包名 | `@firecrawl/anydoc` |
| 锁定版本 | `0.2.4`（`package.json` 中精确锁定，无 `^` / `~`） |
| 官方来源 | <https://github.com/firecrawl/anydoc>（npm 发布） |
| 审计对应提交 | `e7178e099b6bf9171e2c52b832cbdb4134b69112`（`git describe` = `v0.2.4-7-ge7178e0`） |
| 许可证 | MIT |
| 版权声明 | `Copyright (c) 2026 Sideguide Technologies Inc.` |
| 许可原文位置 | [licenses/anydoc-LICENSE.txt](licenses/anydoc-LICENSE.txt)（自上游仓库该提交的 `LICENSE` 取回，未修改） |
| 本项目使用方式 | 作为普通 npm 运行依赖，通过其公开 Node.js API（`toMarkdownBytes` / `toDocument` / `formatFromBytes` 等）调用，**未复制、未修改、未重新编译**其源码 |
| 是否随本项目分发 | **否**。`node_modules/` 不进入源码仓库；安装插件时由包管理器按平台获取 `@firecrawl/anydoc` 及其平台包 |

补充事实：

- npm 包本身**不携带 LICENSE 文件**，只在 `package.json` 声明 `"license": "MIT"`；因此许可原文以其 GitHub 仓库对应提交为准。
- 该包**没有任何 install / postinstall 脚本**（已检查包内 `package.json`），安装时不执行额外代码。
- 各平台预编译包（`@firecrawl/anydoc-darwin-arm64`、`-win32-x64-msvc` 等）同为 MIT，由 npm 作为 optionalDependency 按目标平台选择；本项目不打包、不再分发它们。

## 2. 测试语料：`test/fixtures/upstream/`

| 项 | 值 |
| --- | --- |
| 内容 | 25 个真实文档样本（doc/docx/xls/xlsb/xlsx/ppt/pptx/odt/ods/odp/rtf/epub/csv/pdf，含损坏与恶意样本） |
| 来源 | `firecrawl/anydoc` 仓库 `tests/fixtures/`，提交 `e7178e099b6bf9171e2c52b832cbdb4134b69112` |
| 许可证 | MIT，版权 `Copyright (c) 2026 Sideguide Technologies Inc.` |
| 许可原文位置 | [licenses/anydoc-LICENSE.txt](licenses/anydoc-LICENSE.txt) |
| 是否修改 | 否，逐字节复制，仅重命名（`docx/text.docx` → `docx-text.docx`），对应关系见 [test/fixtures/upstream/ATTRIBUTION.md](test/fixtures/upstream/ATTRIBUTION.md) |
| 是否随分发 | **是**，随源码仓库用于可复现测试；不进入 npm 安装包（`files` 白名单不含 `test/`） |

## 3. 测试语料：`test/fixtures/generated/`

| 项 | 值 |
| --- | --- |
| 内容 | 10 个由本项目生成的中文/中英混排文档与长文档样本 |
| 生成方式 | [test/fixtures/generate.py](test/fixtures/generate.py)，使用 python-docx / python-pptx / openpyxl / Pillow 在本地生成 |
| 是否含第三方内容 | 否，不含任何真实个人数据；生成库仅在生成阶段使用，不随本项目分发 |
| 是否随分发 | 是（随源码仓库） |

## 4. DSH 运行时依赖（peer，不打包）

以下包**不随本插件分发**，而是由 DeepSeek Harness 的 runtime resolution 解析到当前 DSH 安装内的同名包：

| 包 | 版本约束 | 许可证 | 用途 |
| --- | --- | --- | --- |
| `@deepseek-ai/dsh-tools` | `>=0.2.0-rc.2 <0.2.1-0 \|\| >=0.2.1-rc.2 <0.2.2-0 \|\| >=0.2.2-rc.1 <0.2.3-0`（optional peer） | MIT | `defineTool`、工具注册与执行管线 |
| `@deepseek-ai/schemastery` | `^3.18.5`（optional peer） | MIT | 插件配置 schema |

本项目不复制 DSH 源码，仅调用其公开插件接口（`ctx.tools.register`、`ctx.effect`、`ctx.logger` 等）。

## 5. 开发期依赖（不随运行分发）

| 包 | 版本 | 许可证 | 用途 |
| --- | --- | --- | --- |
| `@deepseek-ai/dsh-tools` | `0.2.2-rc.1` | MIT | 本机运行测试时解析 `defineTool` |
| `@deepseek-ai/schemastery` | `3.19.0` | MIT | 本机运行测试时解析配置 schema |

`npm install --omit=dev` 不会安装它们；`node_modules/` 不进入源码仓库，也不进入安装包。

## 6. 运行时组件（不随本项目分发）

- **Node.js** 与 **Electron**：由 DeepSeek Harness 自身提供，本项目不重新分发。
- 操作系统层面的工具链（npm、git）同理。

## 7. 已核验的许可结论

| 结论 | 依据 |
| --- | --- |
| 本项目分发内容中不含 GPL / LGPL / AGPL 许可的材料 | 随仓库分发的只有本项目代码、本项目生成的样本、以及上游 MIT 测试语料 |
| 不含"仅限非商业使用""需另行取得许可"等附加限制 | 逐项核对了实际分发文件（见上表） |
| 不含来源不明或无许可证的材料 | 所有随仓库分发的第三方内容都能追溯到 `firecrawl/anydoc@e7178e0` |
| 上游版权声明未被替换 | 上游许可证原文保留在 `licenses/anydoc-LICENSE.txt`，本项目 `LICENSE` 中的版权行未覆盖上游声明 |

**范围说明**：以上为对本仓库实际分发内容的检查结论，不构成对第三方组件未来版本或其他使用方式的法律保证。若升级 `@firecrawl/anydoc`、更换测试语料或改变分发方式，需要重新核验。
