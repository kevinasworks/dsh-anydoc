/**
 * Content-correctness tests across every documented format.
 *
 * "No exception thrown" is not a pass here: each case asserts text, structure
 * and formatting that the converted Markdown must actually contain.
 */

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { createHarness, GENERATED, invokeTool, UPSTREAM } from './support/harness.mjs'

/**
 * One row per case: fixture, expected canonical format, and required fragments.
 * `source: 'upstream'` files come from firecrawl/anydoc (MIT, see
 * test/fixtures/upstream/ATTRIBUTION.md); `source: 'generated'` files are
 * produced by test/fixtures/generate.py.
 */
const CASES = [
  {
    name: 'generated/zh-mixed.docx',
    source: 'generated',
    format: 'docx',
    contains: [
      '季度技术评审报告 Quarterly Engineering Review',
      '# 1. 背景 Background',
      '本季度我们在 DeepSeek Harness 中集成了 AnyDoc 解析引擎',
      '***which converts office documents to Markdown locally.***',
      '- 解析完全在本地完成，不上传任何文档。',
      '| **指标 Metric** | **目标 Target** | **实测 Actual** | **结论** |',
      '| 转换耗时 | 60s | 0.8s | 通过 PASS<br>通过 PASS |',
      '图 1：本地解析数据流 (local parsing data flow)',
      '@firecrawl/anydoc 0.2.4 -> toMarkdown(path)',
    ],
  },
  {
    name: 'upstream/docx-text.docx',
    source: 'upstream',
    format: 'docx',
    contains: ['# Fixture Document', '**bold**', '*italic*', '~~struck~~', '## Lists', '1. First numbered', '| Wide head |  | End |'],
  },
  {
    name: 'upstream/docx-handmade-tables.docx',
    source: 'upstream',
    format: 'docx',
    contains: ['| Head A | Head B | Head C |', 'legacy start<br>legacy cont', 'after the table'],
  },
  {
    name: 'upstream/docx-handmade-math.docx',
    source: 'upstream',
    format: 'docx',
    contains: ['$x=\\frac{-b\\pm\\sqrt{b^{2}-4ac}}{2a}$', '$$', '\\sum_{i=1}^{n}'],
  },
  {
    name: 'upstream/docx-handmade-numbering.docx',
    source: 'upstream',
    format: 'docx',
    contains: ['1. One-one', '   - i) One-two-a roman', 'Deep bullet', '10. Ten-start via override'],
  },
  {
    name: 'generated/zh-table.xlsx',
    source: 'generated',
    format: 'xlsx',
    contains: ['## 汇总 Summary', '## 明细 Details', '| 区域 Region | 销售额 Revenue | 增长 Growth | 备注 Note |', '| 华东 East | 128000 | 0.12 | 含中文与 English |', '| 5 | 项目 5 | 5000 |'],
  },
  {
    name: 'upstream/xlsx-handmade-merged.xlsx',
    source: 'upstream',
    format: 'xlsx',
    contains: ['| Merged across |  | padded |', '| tall | b2 | 3.5 |'],
  },
  {
    name: 'upstream/xls-sheet.xls',
    source: 'upstream',
    format: 'xlsx',
    contains: ['## Values', '| Percent | 15.5% | fifteen and a half |', '## Merged Grid', '| Span two |  | Right |'],
  },
  {
    name: 'upstream/xlsb-handmade-sheet.xlsb',
    source: 'upstream',
    format: 'xlsx',
    contains: ['| Region |', '| 42 | 65.0% | $1,234.50 |', '| wide merge |  |  |'],
  },
  {
    name: 'generated/zh-slides.pptx',
    source: 'generated',
    format: 'pptx',
    contains: ['## AnyDoc 解析能力演示', '## 已验证格式 Verified formats', '- 扫描版 PDF 需要 OCR（未启用）', '> 演讲者备注：强调所有解析都在本地完成。', '## 架构 Architecture', 'DSH Tool -> AnyDoc -> Markdown'],
  },
  {
    name: 'upstream/pptx-pres.pptx',
    source: 'upstream',
    format: 'pptx',
    contains: ['Deck Title Slide', '- Nested detail', '> Speaker note for the intro slide.', '| Region | Total |', '> Second slide notes mention the table.'],
  },
  {
    name: 'upstream/ppt-pres.ppt',
    source: 'upstream',
    format: 'ppt',
    contains: ['Deck Title Slide', '- Top level point', '> Speaker note for the intro slide.', 'North'],
  },
  {
    name: 'upstream/odt-text.odt',
    source: 'upstream',
    format: 'odt',
    contains: ['# Fixture Document', '**bold**', '## Lists'],
  },
  {
    name: 'upstream/ods-sheet.ods',
    source: 'upstream',
    format: 'ods',
    contains: ['## Values', '| Currency | $1,234.50 | dollars |', '## Merged Grid'],
  },
  {
    name: 'upstream/odp-pres.odp',
    source: 'upstream',
    format: 'odp',
    contains: ['Deck Title Slide', '> Speaker note for the intro slide.', '| Region | Total |'],
  },
  {
    name: 'upstream/rtf-text.rtf',
    source: 'upstream',
    format: 'rtf',
    contains: ['# Fixture Document', '**bold**', '1. First numbered'],
  },
  {
    name: 'upstream/rtf-handmade-math.rtf',
    source: 'upstream',
    format: 'rtf',
    contains: ['$x=\\frac{-b\\pm\\sqrt{b^{2}-4ac}}{2a}$', '\\sin{\\left(\\theta\\right)}'],
  },
  {
    name: 'upstream/epub-book.epub',
    source: 'upstream',
    format: 'epub',
    contains: ['# Chapter One', '[Chapter Two](#epub-text-ch002-xhtml-chapter-two)', 'Opening paragraph with **bold**'],
  },
  {
    name: 'upstream/csv-sheet.csv',
    source: 'upstream',
    format: 'csv',
    formatSource: 'extension',
    contains: ['| Kind | Value | Note |', '| Percent | 15.5% | fifteen and a half |'],
  },
  {
    name: 'generated/zh-mixed.csv',
    source: 'generated',
    format: 'csv',
    formatSource: 'extension',
    contains: ['| 姓名 | 角色 | 备注 |', '| 张三 | 工程师 | 负责表格, 公式 |', '| Li Si | Reviewer | English, with comma |', '引号 "测试" 与换行'],
  },
  {
    name: 'generated/utf16.csv',
    source: 'generated',
    format: 'csv',
    formatSource: 'extension',
    contains: ['| 列一 | 列二 |', '| 值一 | 值二 |'],
  },
  {
    name: 'upstream/pdf-text.pdf',
    source: 'upstream',
    format: 'pdf',
    contains: ['# Fixture Document', '**bold**', 'First numbered'],
  },
  {
    name: 'generated/zh-long.docx',
    source: 'generated',
    format: 'docx',
    contains: ['# 长文档压力测试 Long document', '## 第 20 章 Chapter 20', '第 20 章的第 8 段'],
  },
]

for (const testCase of CASES) {
  test(`converts ${testCase.name}`, async (t) => {
    const harness = await createHarness({ config: { engine: 'worker' } })
    t.after(harness.dispose)
    const directory = testCase.source === 'generated' ? GENERATED : UPSTREAM
    const result = await invokeTool(harness.tools, 'anydoc_convert', {
      sourcePath: path.join(directory, path.basename(testCase.name)),
      previewChars: 500_000,
    })
    assert.equal(result.success, true, `conversion failed: ${result.errorCode} ${result.errorMessage}`)
    assert.equal(result.errorCode, '')
    assert.equal(result.detectedFormat, testCase.format)
    assert.equal(result.formatSource, testCase.formatSource ?? 'content')
    assert.ok(result.markdownChars > 0)
    assert.ok(result.outputPath.endsWith('.md'))
    const written = await readFile(result.outputPath, 'utf8')
    assert.equal(written.length, result.markdownChars, 'the written file holds the whole Markdown')
    for (const fragment of testCase.contains) {
      assert.ok(written.includes(fragment), `${testCase.name} is missing: ${fragment}\n--- got ---\n${written.slice(0, 2000)}`)
    }
  })
}

test('a mislabelled file is converted by content, not by extension', async (t) => {
  const harness = await createHarness()
  t.after(harness.dispose)
  const disguised = path.join(harness.baseDir, 'disguised.bin')
  const source = await readFile(path.join(UPSTREAM, 'docx-text.docx'))
  await (await import('node:fs/promises')).writeFile(disguised, source)
  const result = await invokeTool(harness.tools, 'anydoc_convert', { sourcePath: disguised })
  assert.equal(result.success, true)
  assert.equal(result.detectedFormat, 'docx')
  assert.equal(result.formatSource, 'content')
  assert.ok(result.warnings.some(message => message.includes('.bin')), 'the unsupported extension is reported, not hidden')
})

test('Chinese, spaced, bracketed and long file names resolve', async (t) => {
  const harness = await createHarness()
  t.after(harness.dispose)
  const names = ['中文 文件名（含空格）.docx', "mixed 'quotes' & #hash.docx", `${'长'.repeat(40)}.docx`]
  for (const name of names) {
    const result = await invokeTool(harness.tools, 'anydoc_convert', { sourcePath: path.join(GENERATED, name) })
    assert.equal(result.success, true, `${name}: ${result.errorCode} ${result.errorMessage}`)
    assert.equal(result.detectedFormat, 'docx')
    assert.match(result.outputPath, /\.md$/)
  }
})

test('a scanned PDF reports the pages that need OCR and stays local', async (t) => {
  const harness = await createHarness()
  t.after(harness.dispose)
  const result = await invokeTool(harness.tools, 'anydoc_convert', { sourcePath: path.join(UPSTREAM, 'pdf-handmade-scanned.pdf') })
  assert.equal(result.success, false)
  assert.equal(result.errorCode, 'NEEDS_OCR')
  assert.deepEqual(result.pages, [1, 2])
  assert.equal(result.outputPath, '')
  assert.ok(harness.logger.lines.some(line => line.level === 'warn' && line.message.includes('NEEDS_OCR')))
})

test('the source document is never modified by a conversion', async (t) => {
  const harness = await createHarness()
  t.after(harness.dispose)
  const source = path.join(GENERATED, 'zh-mixed.docx')
  const before = await readFile(source)
  const result = await invokeTool(harness.tools, 'anydoc_convert', { sourcePath: source, exportAssets: true })
  assert.equal(result.success, true)
  assert.deepEqual(await readFile(source), before)
})

test('assets are exported with valid references in the Markdown', async (t) => {
  const harness = await createHarness()
  t.after(harness.dispose)
  const result = await invokeTool(harness.tools, 'anydoc_convert', {
    sourcePath: path.join(GENERATED, 'zh-mixed.docx'),
    exportAssets: true,
  })
  assert.equal(result.success, true)
  assert.equal(result.assets.length, 1)
  const asset = result.assets[0]
  assert.equal(path.dirname(asset.path), path.join(path.dirname(result.outputPath), 'zh-mixed.assets'), 'assets stay in the output directory')
  assert.ok(asset.bytes > 0)
  const markdown = await readFile(result.outputPath, 'utf8')
  assert.ok(markdown.includes('## Exported assets'))
  assert.ok(markdown.includes(path.basename(asset.path)))
  const exported = await readFile(asset.path)
  assert.equal(exported.byteLength, asset.bytes)
})
