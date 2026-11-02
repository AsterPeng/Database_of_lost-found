"""把 docs/database/00-课程设计报告.md 导出为 Word 文档。

支持：标题、段落、粗体、行内代码、表格、代码块、列表、图片、分页符。
用法：python scripts/db/export-report-docx.py
"""
from pathlib import Path
import re

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Inches, Pt, RGBColor

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "docs" / "database" / "00-课程设计报告.md"
OUTPUT = ROOT / "docs" / "database" / "00-课程设计报告.docx"


def set_east_asia(style, font_name: str) -> None:
    style.font.name = font_name
    if style.element.rPr is None:
        style.element.get_or_add_rPr()
    style.element.rPr.rFonts.set(qn("w:eastAsia"), font_name)


def set_run_font(run, name: str, size: float | None = None, bold: bool | None = None) -> None:
    run.font.name = name
    run._element.rPr.rFonts.set(qn("w:eastAsia"), name)
    if size is not None:
        run.font.size = Pt(size)
    if bold is not None:
        run.bold = bold


def add_page_number(section) -> None:
    footer = section.footer
    paragraph = footer.paragraphs[0]
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    fld = OxmlElement("w:fldSimple")
    fld.set(qn("w:instr"), "PAGE")
    paragraph._p.append(fld)


def shade_paragraph(paragraph, fill: str = "F2F2F2") -> None:
    pPr = paragraph._p.get_or_add_pPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), fill)
    pPr.append(shd)


def add_inline(paragraph, text: str, size: float | None = None) -> None:
    """处理 **粗体** 与 `行内代码`。"""
    parts = re.split(r"(\*\*.+?\*\*|`[^`]+`)", text)
    for part in parts:
        if not part:
            continue
        if part.startswith("**") and part.endswith("**") and len(part) > 4:
            run = paragraph.add_run(part[2:-2])
            set_run_font(run, "宋体", size, bold=True)
        elif part.startswith("`") and part.endswith("`") and len(part) > 2:
            run = paragraph.add_run(part[1:-1])
            set_run_font(run, "Consolas", (size or 10) - 1)
        else:
            run = paragraph.add_run(part)
            set_run_font(run, "宋体", size)


def add_table(document: Document, rows: list[list[str]]) -> None:
    if not rows:
        return
    header = rows[0]
    body = rows[1:]
    table = document.add_table(rows=1, cols=len(header))
    table.style = "Table Grid"
    table.alignment = WD_TABLE_ALIGNMENT.CENTER

    for index, cell_text in enumerate(header):
        cell = table.rows[0].cells[index]
        cell.text = ""
        paragraph = cell.paragraphs[0]
        add_inline(paragraph, cell_text, 9.5)
        for run in paragraph.runs:
            run.bold = True

    for row in body:
        cells = table.add_row().cells
        for index in range(len(header)):
            value = row[index] if index < len(row) else ""
            cells[index].text = ""
            add_inline(cells[index].paragraphs[0], value, 9)

    # 表头重复
    trPr = table.rows[0]._tr.get_or_add_trPr()
    tblHeader = OxmlElement("w:tblHeader")
    tblHeader.set(qn("w:val"), "true")
    trPr.append(tblHeader)


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f"找不到报告源文件：{SOURCE}")

    document = Document()
    section = document.sections[0]
    section.page_height = Cm(29.7)
    section.page_width = Cm(21.0)
    section.top_margin = Cm(2.5)
    section.bottom_margin = Cm(2.5)
    section.left_margin = Cm(2.8)
    section.right_margin = Cm(2.5)
    add_page_number(section)

    styles = document.styles
    set_east_asia(styles["Normal"], "宋体")
    styles["Normal"].font.size = Pt(11)
    styles["Normal"].paragraph_format.line_spacing = 1.5
    for name, size in (("Title", 26), ("Heading 1", 18), ("Heading 2", 15), ("Heading 3", 12)):
        set_east_asia(styles[name], "黑体")
        styles[name].font.size = Pt(size)
        styles[name].font.bold = True
    styles["Title"].alignment = WD_ALIGN_PARAGRAPH.CENTER

    lines = SOURCE.read_text(encoding="utf-8").splitlines()
    index = 0
    in_code = False
    code_lines: list[str] = []
    table_rows: list[list[str]] = []

    def flush_table() -> None:
        nonlocal table_rows
        if table_rows:
            add_table(document, table_rows)
            table_rows = []
            document.add_paragraph()

    def flush_code() -> None:
        nonlocal code_lines
        if code_lines:
            paragraph = document.add_paragraph()
            paragraph.paragraph_format.line_spacing = 1.15
            shade_paragraph(paragraph)
            run = paragraph.add_run("\n".join(code_lines))
            run.font.name = "Consolas"
            run._element.rPr.rFonts.set(qn("w:eastAsia"), "宋体")
            run.font.size = Pt(9)
            code_lines = []

    while index < len(lines):
        line = lines[index]
        stripped = line.strip()

        if in_code:
            if stripped.startswith("```"):
                in_code = False
                flush_code()
            else:
                code_lines.append(line)
            index += 1
            continue

        if stripped.startswith("```"):
            flush_table()
            in_code = True
            index += 1
            continue

        if stripped == "<!-- PAGEBREAK -->":
            flush_table()
            document.add_page_break()
            index += 1
            continue

        if stripped.startswith("|"):
            # 收集表格
            while index < len(lines) and lines[index].strip().startswith("|"):
                row = lines[index].strip().strip("|")
                cells = [cell.strip() for cell in row.split("|")]
                if not all(re.fullmatch(r":?-{2,}:?", cell) for cell in cells):
                    table_rows.append(cells)
                index += 1
            flush_table()
            continue

        if stripped.startswith("# "):
            flush_table()
            paragraph = document.add_heading(stripped[2:].strip(), level=0)
            paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
        elif stripped.startswith("### "):
            flush_table()
            document.add_heading(stripped[4:].strip(), level=2)
        elif stripped.startswith("## "):
            flush_table()
            document.add_heading(stripped[3:].strip(), level=1)
        elif stripped.startswith("#### "):
            flush_table()
            document.add_heading(stripped[5:].strip(), level=3)
        elif stripped.startswith("!["):
            flush_table()
            match = re.match(r"!\[([^\]]*)\]\(([^)]+)\)", stripped)
            if match:
                image_path = (SOURCE.parent / match.group(2)).resolve()
                if image_path.exists():
                    paragraph = document.add_paragraph()
                    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
                    run = paragraph.add_run()
                    run.add_picture(str(image_path), width=Inches(5.9))
                    caption = document.add_paragraph(match.group(1))
                    caption.alignment = WD_ALIGN_PARAGRAPH.CENTER
                    for run in caption.runs:
                        run.italic = True
                        set_run_font(run, "宋体", 9)
        elif stripped.startswith("- "):
            flush_table()
            paragraph = document.add_paragraph(style="List Bullet")
            add_inline(paragraph, stripped[2:].strip())
        elif re.match(r"^\d+\.\s+", stripped):
            flush_table()
            paragraph = document.add_paragraph(style="List Number")
            add_inline(paragraph, re.sub(r"^\d+\.\s+", "", stripped))
        elif stripped.startswith("> "):
            flush_table()
            paragraph = document.add_paragraph()
            add_inline(paragraph, stripped[2:].strip())
            for run in paragraph.runs:
                run.italic = True
        elif stripped == "---":
            index += 1
            continue
        elif stripped:
            flush_table()
            paragraph = document.add_paragraph()
            add_inline(paragraph, stripped)
        index += 1

    flush_table()
    flush_code()

    document.core_properties.title = "校园智能失物招领平台数据库课程设计报告"
    document.core_properties.author = "组员 A / 组员 B / 组员 C"
    document.save(OUTPUT)
    print(f"Word 报告已生成：{OUTPUT}")


if __name__ == "__main__":
    main()