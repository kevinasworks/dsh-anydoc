#!/usr/bin/env python3
"""Generate the dsh-anydoc test fixtures.

The Office fixtures are written with python-docx / python-pptx / openpyxl, so
they are real OOXML packages rather than renamed files. Chinese and English
text are mixed on purpose: the plugin must survive both, plus tables with
merged cells, speaker notes, embedded images and long documents.

Usage:
    /path/to/python3 test/fixtures/generate.py

Fixtures land in test/fixtures/generated/ and are safe to regenerate.
"""

from __future__ import annotations

import io
import os
import zipfile

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor
from openpyxl import Workbook
from openpyxl.styles import Font
from openpyxl.utils import get_column_letter
from PIL import Image, ImageDraw, ImageFont
from pptx import Presentation
from pptx.util import Inches, Pt as PptPt

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "generated")


def ensure_out() -> None:
    os.makedirs(OUT, exist_ok=True)


def sample_png() -> bytes:
    """A small labelled PNG, drawn without relying on any font file."""
    image = Image.new("RGB", (240, 120), (238, 244, 255))
    draw = ImageDraw.Draw(image)
    draw.rectangle([4, 4, 235, 115], outline=(47, 111, 221), width=4)
    draw.line([(20, 90), (60, 40), (100, 75), (140, 30), (200, 60)], fill=(27, 75, 176), width=5)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def set_cjk_font(run, name: str = "PingFang SC") -> None:
    run.font.name = name
    run._element.rPr.rFonts.set(qn("w:eastAsia"), name)


def build_docx() -> None:
    doc = Document()

    title = doc.add_heading("季度技术评审报告 Quarterly Engineering Review", level=0)
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER

    doc.add_heading("1. 背景 Background", level=1)
    paragraph = doc.add_paragraph()
    run = paragraph.add_run("本季度我们在 DeepSeek Harness 中集成了 AnyDoc 解析引擎，")
    set_cjk_font(run)
    run2 = paragraph.add_run("which converts office documents to Markdown locally.")
    run2.bold = True
    run2.italic = True

    doc.add_heading("2. 关键结论 Key findings", level=1)
    doc.add_paragraph("解析完全在本地完成，不上传任何文档。", style="List Bullet")
    doc.add_paragraph("表格、合并单元格与公式均被保留。", style="List Bullet")
    nested = doc.add_paragraph("嵌套列表 nested bullet", style="List Bullet 2")
    nested.add_run(" — 第二层").font.size = Pt(10)

    doc.add_heading("3. 发布步骤 Release steps", level=1)
    for index, text in enumerate(["安装插件", "运行真实 Tool Call", "检查输出内容"], start=1):
        doc.add_paragraph(f"{text} step {index}", style="List Number")

    doc.add_heading("4. 指标表 Metrics", level=1)
    table = doc.add_table(rows=1, cols=4)
    table.style = "Table Grid"
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    header = table.rows[0].cells
    for cell, text in zip(header, ["指标 Metric", "目标 Target", "实测 Actual", "结论"]):
        cell.text = ""
        cell.paragraphs[0].add_run(text).bold = True

    rows = [
        ("转换耗时", "60s", "0.8s", "通过 PASS"),
        ("中文字符", "无乱码", "完整保留", "通过 PASS"),
        ("表格结构", "无缺行缺列", "4 行 4 列", "通过 PASS"),
    ]
    for metric, target, actual, verdict in rows:
        cells = table.add_row().cells
        for cell, text in zip(cells, (metric, target, actual, verdict)):
            cell.text = ""
            run = cell.paragraphs[0].add_run(text)
            set_cjk_font(run)
            run.font.size = Pt(9)

    # Merged cell: the first two rows of the last column become one cell.
    table.cell(1, 3).merge(table.cell(2, 3))

    doc.add_heading("5. 架构图 Architecture", level=1)
    doc.add_picture(io.BytesIO(sample_png()), width=Inches(2.4))
    doc.add_paragraph("图 1：本地解析数据流 (local parsing data flow)")

    doc.add_heading("6. 代码与公式 Code and formulas", level=1)
    code = doc.add_paragraph()
    code_run = code.add_run("@firecrawl/anydoc 0.2.4 -> toMarkdown(path)")
    code_run.font.name = "Menlo"
    code_run.font.size = Pt(9)

    link = doc.add_paragraph()
    link.add_run("参考 reference: ").font.size = Pt(10)

    doc.save(os.path.join(OUT, "zh-mixed.docx"))

    # A long document for preview truncation and performance checks.
    long_doc = Document()
    long_doc.add_heading("长文档压力测试 Long document", level=1)
    for chapter in range(1, 21):
        long_doc.add_heading(f"第 {chapter} 章 Chapter {chapter}", level=2)
        for line in range(8):
            long_doc.add_paragraph(
                f"这是第 {chapter} 章的第 {line + 1} 段，用于验证长文档的截断与写入行为。"
                f" Paragraph {line + 1} of chapter {chapter} keeps the converter busy."
            )
    long_doc.save(os.path.join(OUT, "zh-long.docx"))


def build_heavy() -> None:
    """A document large enough that a 1 ms deadline really expires."""
    heavy = Document()
    heavy.add_heading("重型文档 Heavy fixture", level=1)
    for index in range(3000):
        heavy.add_paragraph(
            f"段落 {index} — payload paragraph number {index} with enough text to make conversion take measurable time."
        )
    heavy.save(os.path.join(OUT, "zh-heavy.docx"))


def build_xlsx() -> None:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "汇总 Summary"
    sheet["A1"] = "区域 Region"
    sheet["B1"] = "销售额 Revenue"
    sheet["C1"] = "增长 Growth"
    sheet["D1"] = "备注 Note"
    for cell in ("A1", "B1", "C1", "D1"):
        sheet[cell].font = Font(bold=True)
    data = [
        ("华东 East", 128000, 0.12, "含中文与 English"),
        ("华南 South", 96000, -0.03, "季度回落"),
        ("华北 North", 155000, 0.21, "new record"),
        ("西南 Southwest", 74000, 0.05, "试点"),
    ]
    for row_index, row in enumerate(data, start=2):
        for column_index, value in enumerate(row, start=1):
            sheet.cell(row=row_index, column=column_index, value=value)
    sheet.merge_cells("D2:D3")
    for column in range(1, 5):
        sheet.column_dimensions[get_column_letter(column)].width = 18

    second = workbook.create_sheet("明细 Details")
    second["A1"] = "序号"
    second["B1"] = "项目 Item"
    second["C1"] = "金额 Amount"
    for index in range(1, 6):
        second.cell(row=index + 1, column=1, value=index)
        second.cell(row=index + 1, column=2, value=f"项目 {index}")
        second.cell(row=index + 1, column=3, value=index * 1000)
    second.freeze_panes = "A2"

    workbook.save(os.path.join(OUT, "zh-table.xlsx"))


def build_pptx() -> None:
    presentation = Presentation()
    slide = presentation.slides.add_slide(presentation.slide_layouts[0])
    slide.shapes.title.text = "AnyDoc 解析能力演示"
    slide.placeholders[1].text = "Local document parsing in DeepSeek Harness"

    bullets = presentation.slides.add_slide(presentation.slide_layouts[1])
    bullets.shapes.title.text = "已验证格式 Verified formats"
    frame = bullets.placeholders[1].text_frame
    frame.text = "Word / PowerPoint / Excel"
    for text in ["OpenDocument / RTF / EPUB", "CSV 与文本型 PDF", "扫描版 PDF 需要 OCR（未启用）"]:
        paragraph = frame.add_paragraph()
        paragraph.text = text
        paragraph.level = 0

    bullets.notes_slide.notes_text_frame.text = "演讲者备注：强调所有解析都在本地完成。 Speaker note: everything stays local."

    image_slide = presentation.slides.add_slide(presentation.slide_layouts[5])
    image_slide.shapes.title.text = "架构 Architecture"
    image_slide.shapes.add_picture(io.BytesIO(sample_png()), Inches(1.5), Inches(1.6), width=Inches(4))
    text_box = image_slide.shapes.add_textbox(Inches(1.2), Inches(5.2), Inches(6), Inches(1))
    text_box.text_frame.text = "DSH Tool -> AnyDoc -> Markdown"

    presentation.save(os.path.join(OUT, "zh-slides.pptx"))


def build_csv() -> None:
    text = (
        "姓名,角色,备注\n"
        "张三,工程师,\"负责表格, 公式\"\n"
        "Li Si,Reviewer,\"English, with comma\"\n"
        "王五,Manager,\"引号 \"\"测试\"\" 与换行\"\n"
    )
    with open(os.path.join(OUT, "zh-mixed.csv"), "w", encoding="utf-8", newline="") as handle:
        handle.write(text)


def build_utf16_csv() -> None:
    text = "列一,列二\n值一,值二\n"
    with open(os.path.join(OUT, "utf16.csv"), "w", encoding="utf-16", newline="") as handle:
        handle.write(text)


def build_odd_names() -> None:
    """Path-hostile names that must still resolve."""
    source = os.path.join(OUT, "zh-mixed.docx")
    for name in ["中文 文件名（含空格）.docx", "mixed 'quotes' & #hash.docx", "长" * 40 + ".docx"]:
        with open(source, "rb") as reader, open(os.path.join(OUT, name), "wb") as writer:
            writer.write(reader.read())


def main() -> None:
    ensure_out()
    build_docx()
    build_heavy()
    build_xlsx()
    build_pptx()
    build_csv()
    build_utf16_csv()
    build_odd_names()
    for name in sorted(os.listdir(OUT)):
        path = os.path.join(OUT, name)
        if os.path.isfile(path) and zipfile.is_zipfile(path):
            with zipfile.ZipFile(path) as archive:
                archive.namelist()  # noqa: B018 - validates the package
    print(f"generated {len(os.listdir(OUT))} fixtures in {OUT}")


if __name__ == "__main__":
    main()
