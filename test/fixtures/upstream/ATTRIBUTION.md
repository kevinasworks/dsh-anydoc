# 测试语料来源与许可

`test/fixtures/upstream/` 下的文件复制自 [firecrawl/anydoc](https://github.com/firecrawl/anydoc) 仓库的 `tests/fixtures/` 目录。

- 上游 SHA：`e7178e099b6bf9171e2c52b832cbdb4134b69112`（`v0.2.4-7-ge7178e0`）
- 许可证：MIT，版权归 `Sideguide Technologies Inc.`（上游仓库根目录 `LICENSE`）
- 许可原文：本仓库随附一份未修改的副本 → [`licenses/anydoc-LICENSE.txt`](../../../licenses/anydoc-LICENSE.txt)
- 用途：仅用于验证本插件的格式覆盖与错误处理，不随插件运行时分发

| 本地文件名 | 上游路径 |
| --- | --- |
| `doc-text.doc` | `doc/text.doc` |
| `docx-text.docx` | `docx/text.docx` |
| `docx-handmade-tables.docx` | `docx/handmade-tables.docx` |
| `docx-handmade-math.docx` | `docx/handmade-math.docx` |
| `docx-handmade-rich.docx` | `docx/handmade-rich.docx` |
| `docx-handmade-numbering.docx` | `docx/handmade-numbering.docx` |
| `xlsx-sheet.xlsx` | `xlsx/sheet.xlsx` |
| `xlsx-handmade-merged.xlsx` | `xlsx/handmade-merged.xlsx` |
| `xls-sheet.xls` | `xls/sheet.xls` |
| `xlsb-handmade-sheet.xlsb` | `xlsb/handmade-sheet.xlsb` |
| `ppt-pres.ppt` | `ppt/pres.ppt` |
| `pptx-pres.pptx` | `pptx/pres.pptx` |
| `odt-text.odt` | `odt/text.odt` |
| `ods-sheet.ods` | `ods/sheet.ods` |
| `odp-pres.odp` | `odp/pres.odp` |
| `rtf-text.rtf` | `rtf/text.rtf` |
| `rtf-handmade-math.rtf` | `rtf/handmade-math.rtf` |
| `epub-book.epub` | `epub/book.epub` |
| `csv-sheet.csv` | `csv/sheet.csv` |
| `pdf-text.pdf` | `pdf/text.pdf` |
| `pdf-handmade-scanned.pdf` | `pdf/handmade-scanned.pdf` |
| `malformed-encrypted--errors.odt` | `malformed/encrypted--errors.odt` |
| `malformed-empty--errors.docx` | `malformed/empty--errors.docx` |
| `malformed-truncated--errors.docx` | `malformed/truncated--errors.docx` |
| `abuse-zipbomb--errors.docx` | `abuse/zipbomb--errors.docx` |

`test/fixtures/generated/` 下的文件由 `test/fixtures/generate.py` 生成，不含真实个人数据，可随时重新生成。
