# 发布说明

项目使用 GitHub 保存源码、Release 记录更新说明，并准备通过 npm 公共注册表分发可安装插件。源码与运行依赖安装分开管理；不在包中分发 AnyDoc 原生二进制。

## npm 包与首次发布

- 包名：`dsh-anydoc`；当前版本：`0.2.1`。
- `package.json` 已移除阻止发布的 `private: true`，`publishConfig` 固定为 npm 官方源与公开访问。
- `files` 白名单包含入口、运行模块、语言文件、图标、文档，以及 `LICENSE`、`THIRD_PARTY_NOTICES.md`、`licenses/`。
- 不包含 `node_modules/`、`.audit/`、`.backup/`、测试语料、工作流或本机私人配置。
- 许可证署名继续使用 Kevin Zheng，AnyDoc 依赖继续固定为 0.2.4。

首次发布需由所有者通过 npm 官方浏览器流程登录，并完成 npm 要求的发布身份验证。不要把密码、Token 或验证码写入源码、工作流或聊天。

```bash
npm login --auth-type=web --registry=https://registry.npmjs.org
npm pack --dry-run --json
npm publish --access public
```

本文件描述发布流程，实际发布状态以 https://www.npmjs.com/package/dsh-anydoc 为准；未完成发布时包名查询会返回未找到。

## 后续自动发布：Trusted Publishing

工作流文件为 `.github/workflows/npm-publish.yml`。在首次发布后，所有者需要在 npm 的包设置中添加 GitHub Actions Trusted Publisher：

| 设置 | 值 |
| --- | --- |
| Repository owner | `kevinasworks` |
| Repository name | `dsh-anydoc` |
| Workflow filename | `npm-publish.yml` |
| Environment | 留空（工作流未指定 environment） |

这一步不能由 GitHub 仓库中的 YAML 单独替代。配置完成后不需要向 GitHub 保存长期 npm 发布 Token。

以后更新步骤：

1. 修改代码并同步 `package.json`、`package-lock.json` 版本号，更新 CHANGELOG。
2. 提交推送，为对应提交创建 `v<版本号>` 标签及正式 GitHub Release。
3. Release 的 published 事件触发工作流；先复用七平台完整验证，全部通过才进入发布。
4. 校验 Release 标签与包版本一致，再用 OIDC 与 provenance 发布 npm。

工作流仅对正式 Release 执行发布，不自动发布 prerelease；不应移动已发布标签或覆盖同一个 npm 版本。首次 `0.2.1` 为本地登录后发布，现有 GitHub Release 不需要重新创建。

## 用户安装与升级

用户在 DSH 添加插件时填写 `dsh-anydoc`。刷新插件列表或打开详情的版本区块可检查兼容新版，并点击更新；这不等于主动通知所有用户。

GitHub、压缩包或本地目录安装用户需记录配置、卸载旧安装，再改用 npm 安装一次。后续版本由 DSH 的更新流程处理。中国大陆镜像未同步时可先使用官方源。

## 验证与许可记录

平台支持以 PLATFORM_SUPPORT.md 为准；历史测试与发布检查保存在 TEST_REPORT.md。第三方来源与许可说明见 THIRD_PARTY_NOTICES.md 及 licenses/。不重复把旧的发布准备状态当作当前状态。
