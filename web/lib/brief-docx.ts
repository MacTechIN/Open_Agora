/**
 * 권고서 DOCX 변환 (VS-H1) — 서버 전용.
 *
 * **마크다운을 한 번 더 쓰지 않습니다.** `brief.ts` 가 만든 마크다운을 그대로
 * 읽어 문단으로 바꿉니다. 형식마다 따로 쓰면 TXT 와 DOCX 의 내용이 갈리고,
 * 그 차이는 두 파일을 나란히 열어 보는 사람에게만 보입니다.
 *
 * PDF 를 여기서 만들지 않는 이유는 한글 글꼴입니다. 서버에서 PDF 를 만들면
 * 글꼴 파일을 함께 실어야 하고, 라이선스와 용량을 감당해도 기기마다 다르게
 * 보입니다. 브라우저 인쇄는 사용자가 이미 가진 글꼴로 뽑습니다.
 */
import {
  AlignmentType, Document, HeadingLevel, Packer, Paragraph,
  Table, TableCell, TableRow, TextRun, WidthType,
} from "docx";

/** 맑은 고딕 — 관공서 문서가 대부분 이 글꼴이다. */
const FONT = "Malgun Gothic";

/**
 * `**굵게**` · `*기울임*` · `` `코드` `` 만 해석한다.
 *
 * 해석하지 않으면 별표가 문서에 그대로 찍힌다 — 기관에 내는 문서에 마크다운
 * 기호가 남으면 그것만으로 신뢰를 잃는다.
 */
function runs(text: string, opts: { italics?: boolean; color?: string } = {}): TextRun[] {
  const out: TextRun[] = [];
  const pattern = /\*\*([^*]+)\*\*|\*([^*\n]+)\*|`([^`]+)`/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) {
      out.push(new TextRun({ text: text.slice(last, match.index), font: FONT, ...opts }));
    }
    if (match[1] !== undefined) {
      out.push(new TextRun({ text: match[1], font: FONT, bold: true, ...opts }));
    } else if (match[2] !== undefined) {
      out.push(new TextRun({ ...opts, text: match[2], font: FONT, italics: true }));
    } else {
      out.push(new TextRun({ text: match[3], font: "Consolas", size: 18, ...opts }));
    }
    last = pattern.lastIndex;
  }
  if (last < text.length) {
    out.push(new TextRun({ text: text.slice(last), font: FONT, ...opts }));
  }
  return out.length > 0 ? out : [new TextRun({ text: "", font: FONT })];
}

const cell = (text: string, header: boolean) =>
  new TableCell({
    children: [new Paragraph({
      children: [new TextRun({ text, font: FONT, bold: header, size: 20 })],
    })],
    width: { size: 50, type: WidthType.PERCENTAGE },
  });

function tableFrom(rows: string[]): Table {
  // 마크다운 표의 구분선(`|-|-|`)은 버린다.
  const cells = rows
    .filter((row) => !/^\|[\s:|-]+\|$/.test(row))
    .map((row) => row.split("|").slice(1, -1).map((c) => c.trim()));
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: cells.map((columns, index) =>
      new TableRow({ children: columns.map((c) => cell(c, index === 0)) })),
  });
}

/** 마크다운 권고서를 DOCX 바이트로 바꾼다. */
export async function toDocx(markdown: string): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [];
  const lines = markdown.split("\n");

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (line.trim() === "") continue;

    if (line.startsWith("|")) {
      const rows: string[] = [];
      while (i < lines.length && lines[i].startsWith("|")) { rows.push(lines[i]); i += 1; }
      i -= 1;
      children.push(tableFrom(rows));
      children.push(new Paragraph({ text: "" }));
      continue;
    }

    if (line.startsWith("### ")) {
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_3, spacing: { before: 200, after: 100 },
        children: runs(line.slice(4)),
      }));
    } else if (line.startsWith("## ")) {
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_2, spacing: { before: 320, after: 140 },
        children: runs(line.slice(3)),
      }));
    } else if (line.startsWith("# ")) {
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER,
        spacing: { after: 280 }, children: runs(line.slice(2)),
      }));
    } else if (line.startsWith("> ")) {
      // 인용은 원문이다. 왼쪽을 들여쓰고 회색으로 둬서 우리 말과 구분한다.
      children.push(new Paragraph({
        indent: { left: 480 }, spacing: { after: 60 },
        children: runs(line.slice(2), { color: "444444" }),
      }));
    } else if (line.startsWith("* ")) {
      children.push(new Paragraph({
        bullet: { level: 0 }, spacing: { after: 60 }, children: runs(line.slice(2)),
      }));
    } else if (line.trim() === "---") {
      children.push(new Paragraph({
        border: { bottom: { style: "single", size: 6, color: "999999", space: 1 } },
        spacing: { before: 240, after: 240 }, text: "",
      }));
    } else if (line.startsWith("*") && line.endsWith("*") && !line.startsWith("**")) {
      children.push(new Paragraph({
        spacing: { after: 140 },
        children: runs(line.slice(1, -1), { italics: true, color: "666666" }),
      }));
    } else {
      children.push(new Paragraph({ spacing: { after: 140 }, children: runs(line) }));
    }
  }

  const document = new Document({
    styles: { default: { document: { run: { font: FONT, size: 22 } } } },
    sections: [{ children }],
  });
  return Packer.toBuffer(document);
}
