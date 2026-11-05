# 随分发的第三方许可证

本目录保存本项目重新分发其内容时，必须随附的第三方许可证原文。文件内容保持原样，未做任何修改；来源与校验值见下表。

| 文件 | 对应组件 | 适用内容 | 来源 | 校验值（SHA-256） |
| --- | --- | --- | --- | --- |
| `anydoc-LICENSE.txt` | [firecrawl/anydoc](https://github.com/firecrawl/anydoc)（MIT，版权归 Sideguide Technologies Inc.） | `test/fixtures/upstream/` 下的测试文档，以及通过 npm 安装的 `@firecrawl/anydoc@0.2.4` 运行依赖 | <https://raw.githubusercontent.com/firecrawl/anydoc/e7178e099b6bf9171e2c52b832cbdb4134b69112/LICENSE> | `03a9e7657aac6536fb6458bd220347c4e7f85bd0a51d8d9e8528530b7a682ade` |

说明：

- 该文件取自上游仓库在 **提交 `e7178e099b6bf9171e2c52b832cbdb4134b69112`**（tag `v0.2.4` 之后 7 个提交，即审计基线）时的 `LICENSE`。
- `@firecrawl/anydoc` 的 npm 包本身**不携带 LICENSE 文件**（包内只有 JS、类型声明与 README），只在 `package.json` 中声明 `"license": "MIT"`。因此以仓库根目录的许可证原文为准。
- 本项目**不复制、不修改、不重新编译** AnyDoc 源码，也不在本仓库中分发其原生二进制；`.node` 文件由使用者在安装时通过 npm 获取。上游许可证随附的原因是测试语料复制与运行依赖的许可提示。

若未来升级 `@firecrawl/anydoc` 或更换测试语料来源，必须重新取回对应版本的许可证原文并更新本表。
