# 发布准备说明

本文件记录 `dsh-anydoc` 面向 GitHub 公开发布的**范围、已完成的检查、元数据建议与待确认事项**。它描述的是本地准备结果；本仓库尚未创建远程仓库，也尚未推送任何代码。

## 1. 发布形态

本项目有三种不同的分发形态，需要分别验收，不能混为一谈：

| 形态 | 内容 | 当前状态 |
| --- | --- | --- |
| **A. GitHub 源码仓库** | 源码、构建/测试脚本、文档、许可证、测试语料 | 见第 6 节结论 |
| **B. 可安装插件包**（`npm pack` 产物 / 未来的 npm 发布） | 由 `files` 白名单决定的最小集合 | 见第 6 节结论 |
| **C. 从 GitHub 直接安装**（`install_bundle` 指向 `owner/repo`） | 需要 A 已公开且可安装 | 未测试（无远程仓库） |

## 2. 源码仓库内容

**进入仓库**（受 `.gitignore` 与人工核对约束）：

```text
index.js  lib/  locale/  icon.svg  cordis.patch.yml
package.json  package-lock.json
README.md  ARCHITECTURE.md  CONFIGURATION.md  PLATFORM_SUPPORT.md
SOURCE_AUDIT.md  TEST_REPORT.md  KNOWN_LIMITATIONS.md  CHANGELOG.md
THIRD_PARTY_NOTICES.md  LICENSE  PUBLISHING.md
licenses/anydoc-LICENSE.txt  licenses/README.md
test/*.test.mjs  test/*.mjs  test/support/  test/compat/
test/fixtures/upstream/（25 个上游样本 + ATTRIBUTION.md）
test/fixtures/generated/（本项目生成的 10 个样本 + 生成脚本）
.github/workflows/platform-ci.yml
```

**不进入仓库**：

| 项 | 原因 |
| --- | --- |
| `node_modules/` | 平台相关依赖，安装时获取；含原生二进制，不应入库 |
| `.backup/` | 本机 DSH profile 配置快照（个人环境信息） |
| `.audit/` | 本地审计证据（哈希基线等） |
| `*.tgz` | `npm pack` 产物 |
| `.DS_Store`、日志 | 系统噪声 |

`.gitignore` 已覆盖以上各项；但**忽略规则不等于已处理历史**——本目录目前不是 Git 仓库，不存在历史。

## 3. 已执行的检查

| 检查 | 方法 | 结果 |
| --- | --- | --- |
| 与上游的代码关系 | 逐项核对随仓库分发的文件；确认 `lib/`、`index.js` 中无上游代码 | 仅依赖调用 + 复制 25 个测试样本；无源码复制、无修改、无二进制打包 |
| AnyDoc 实际版本 | `package.json` 锁定值 + `package-lock.json` + 已安装包 `package.json` | 三处均为 `0.2.4` |
| 上游许可证 | 从上游仓库提交 `e7178e0…` 取回 `LICENSE` 原文 | MIT，`Copyright (c) 2026 Sideguide Technologies Inc.`；原文存于 `licenses/anydoc-LICENSE.txt`，SHA-256 记录在 `licenses/README.md` |
| npm 包是否自带 LICENSE | 检查 `node_modules/@firecrawl/anydoc/` 文件列表 | **没有** LICENSE 文件，只有 `package.json` 的 `"license": "MIT"` → 以仓库原文为准 |
| 第三方依赖许可 | 直接依赖、peer、devDependency 逐个核对 | 全部 MIT；无 GPL/LGPL/AGPL；无附加限制 |
| 敏感信息：个人路径 | 检索 `/Users/`、`/Volumes/`、用户名等 | 公开文档已替换为 `$DSH_HOME`、`/path/to/...`、`~/Documents/...`；源码中无个人路径 |
| 敏感信息：凭据 | 检索 `sk-`、`ghp_`、`AKIA`、私钥头、`xox[baprs]-` 等 | 未发现真实凭据；测试中唯一形似密钥的字符串已改为 `placeholder-not-a-real-key` |
| 敏感信息：会话/邮箱/内网 | 检索 `session-<uuid>`、邮箱、私有网段 | 公开文件中未发现（`node_modules` 内的命中不计入，且不发布） |
| 打包内容 | `npm pack` 后解包核对文件清单 | 见第 5 节 |
| 功能回归 | 106 项自动化测试、三条 DSH 线兼容检查、平台产物检查 | 全通过（见 TEST_REPORT.md） |

**未覆盖范围**：未检查本机其他目录；未扫描 Git 历史（不存在仓库）；未做第三方组件的深度二进制成分分析（只核对了包元数据与实际文件清单）；`.audit/` 中保存的是哈希基线，不含密钥。

## 4. GitHub 元数据建议（未远程写入）

| 项 | 建议值 |
| --- | --- |
| 仓库名 | `dsh-anydoc`（沿用现有包名与注册名，避免为改名破坏安装标识） |
| 描述 | `DeepSeek Harness plugin: local, offline document-to-Markdown parsing via Firecrawl AnyDoc (Word/PowerPoint/Excel/OpenDocument/RTF/EPUB/CSV/PDF).` |
| 中文描述（可选） | `DSH 原生插件：用 Firecrawl AnyDoc 在本地把办公文档解析为 Markdown，不上传文件。` |
| Topics | `dsh-plugin`、`deepseek-harness`、`anydoc`、`firecrawl`、`document-parser`、`document-conversion`、`markdown`、`nodejs` |
| 不建议的 Topics | `typescript`（本项目是纯 JavaScript ESM）、`rust`（Rust 引擎来自上游，本项目未实现）、`ocr`（未实现 OCR）、`pdf`（只是上游支持的输入格式之一，容易误导） |

## 5. 安装包（`npm pack`）检查

`files` 白名单决定最终包内容；已把 `licenses/*` 加入。实际打包结果与解包核对记录见 `TEST_REPORT.md` 的发布检查章节与本次审计报告（`.audit/`）。

安装包**不包含**：`test/`（含上游测试语料）、`node_modules/`、`.backup/`、`.audit/`、`.github/`。

## 6. 结论

| 维度 | 结论 | 依据 |
| --- | --- | --- |
| 源码公开准备 | **READY** | 许可证（版权已确认为 Kevin Zheng）、第三方声明、隐私清理、`.gitignore`、README 来源声明、元数据建议均已完成 |
| 安装包分发准备 | **READY** | 上述材料齐备；`npm pack` 产物已解包核验（29 个文件，含 `LICENSE` / `THIRD_PARTY_NOTICES.md` / `licenses/`），并在隔离目录安装后完成注册与真实转换 |
| GitHub 直接安装 | **NOT_TESTED** | 没有远程仓库，无法验证 `install_bundle` 指向 GitHub 的路径 |

READY 只表示本轮明确范围内的检查通过，不代表无限范围的法律担保。

## 7. 发布前待处理事项

1. **版权署名**：**已确认**。2026-11-06 由项目所有者确认为 **Kevin Zheng**；`LICENSE` 第 3 行为 `Copyright (c) 2026 Kevin Zheng`，`package.json` 的 `author` 同为 `Kevin Zheng`。
2. **仓库地址**：`package.json` 尚未写 `repository` / `homepage` / `bugs`；确定 GitHub 地址后补上（不填虚构地址）。
3. **npm 发布**：`package.json` 目前 `"private": true`，可防误发；若计划发布到 npm，需要另外决定包名与是否保留 `private`。
4. **测试语料是否随仓库公开**：目前默认公开（MIT + 归属说明）。若希望仓库更小，可移除 `test/fixtures/upstream/` 并改为下载脚本——需要你确认。

以上第 2–4 项都不阻塞源码公开与安装包分发，只影响后续 npm 发布与仓库体积。

## 8. 获得授权后的发布步骤（当前未执行）

```bash
# 1. 确认仓库地址已更新（署名已确认）
# 2. 本地初始化并提交（本项目当前不是 Git 仓库）
git init && git add -A && git commit -m "dsh-anydoc 0.2.0"
# 3. 创建远程并推送（需你明确授权）
# 4. 打 tag 并发布 Release（需你明确授权）
```

本次**没有**创建远程仓库、没有 `git init`、没有提交、没有推送、没有发布 Release 或 npm 包、没有修改任何远程 Topics。
