import { saveAs } from 'file-saver'
import { Document, Packer, Paragraph, HeadingLevel, TextRun, AlignmentType } from 'docx'

export type ExportableScript = {
  id: string
  title: string
  plot: string
  type: string
  genre: string
  tone: string
  content: string
  createdAt: string
}

export type ExportLabels = {
  type: string
  genre: string
  tone: string
  createdAt: string
  plot: string
  content: string
}

const sanitize = (s: string) =>
  (s || 'script').replace(/[\\/:*?"<>|\n\r\t]+/g, '_').replace(/\s+/g, '_').slice(0, 60) || 'script'

const fileBase = (s: ExportableScript) => {
  const date = s.createdAt ? s.createdAt.slice(0, 10) : new Date().toISOString().slice(0, 10)
  return `${sanitize(s.title)}_${sanitize(s.type)}_${date}`
}

const formatDate = (iso: string) => {
  try {
    const d = new Date(iso)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  } catch {
    return iso
  }
}

export function exportScriptAsTxt(s: ExportableScript, labels: ExportLabels) {
  const line = '═'.repeat(40)
  const sep = '─'.repeat(40)
  const text = [
    line,
    s.title,
    line,
    '',
    `${labels.type}: ${s.type}`,
    `${labels.genre}: ${s.genre}`,
    `${labels.tone}: ${s.tone}`,
    `${labels.createdAt}: ${formatDate(s.createdAt)}`,
    '',
    `${labels.plot}:`,
    s.plot || '',
    '',
    sep,
    `${labels.content}:`,
    sep,
    '',
    s.content || '',
    '',
  ].join('\n')

  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  saveAs(blob, `${fileBase(s)}.txt`)
}

export async function exportScriptAsDocx(s: ExportableScript, labels: ExportLabels) {
  const metaLine = (k: string, v: string) =>
    new Paragraph({
      children: [
        new TextRun({ text: `${k}：`, bold: true }),
        new TextRun({ text: v }),
      ],
      spacing: { after: 80 },
    })

  const contentParas = (s.content || '').split('\n').map(
    line =>
      new Paragraph({
        children: [new TextRun({ text: line, font: 'Consolas', size: 22 })],
        spacing: { after: 40 },
      }),
  )

  const plotParas = (s.plot || '').split('\n').map(
    line => new Paragraph({ children: [new TextRun({ text: line })], spacing: { after: 40 } }),
  )

  const doc = new Document({
    styles: {
      default: { document: { run: { font: 'Arial', size: 24 } } },
    },
    sections: [
      {
        properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: s.title, bold: true, size: 36 })],
            spacing: { after: 240 },
          }),
          metaLine(labels.type, s.type),
          metaLine(labels.genre, s.genre),
          metaLine(labels.tone, s.tone),
          metaLine(labels.createdAt, formatDate(s.createdAt)),
          new Paragraph({ children: [new TextRun({ text: '' })], spacing: { after: 120 } }),
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            children: [new TextRun({ text: labels.plot, bold: true })],
            spacing: { after: 120 },
          }),
          ...plotParas,
          new Paragraph({ children: [new TextRun({ text: '' })], spacing: { after: 120 } }),
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            children: [new TextRun({ text: labels.content, bold: true })],
            spacing: { after: 120 },
          }),
          ...contentParas,
        ],
      },
    ],
  })

  const blob = await Packer.toBlob(doc)
  saveAs(blob, `${fileBase(s)}.docx`)
}
