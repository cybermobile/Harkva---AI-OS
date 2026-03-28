'use strict';

const path = require('path');
const fs = require('fs/promises');
const { Document, Packer, Paragraph, TextRun } = require('docx');
const ExcelJS = require('exceljs');
const PptxGenJS = require('pptxgenjs');

/**
 * Create a .docx file with optional initial content.
 */
async function createDocx(filePath, title) {
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({
          children: [
            new TextRun({ text: title || 'Untitled Document', bold: true, size: 32 }),
          ],
        }),
        new Paragraph({ children: [new TextRun('')] }),
      ],
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, buffer);
}

/**
 * Create a .xlsx file with a default sheet.
 */
async function createXlsx(filePath, title) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Harkva AI-OS';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(title || 'Sheet1');
  sheet.columns = [
    { header: 'Column A', key: 'a', width: 20 },
    { header: 'Column B', key: 'b', width: 20 },
    { header: 'Column C', key: 'c', width: 20 },
  ];

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await workbook.xlsx.writeFile(filePath);
}

/**
 * Create a .pptx file with a title slide.
 */
async function createPptx(filePath, title) {
  const pptx = new PptxGenJS();
  const slide = pptx.addSlide();
  slide.addText(title || 'Untitled Presentation', {
    x: 1, y: 1, w: 8, h: 2,
    fontSize: 36, bold: true, color: '3D2B1F',
    align: 'center', valign: 'middle',
  });

  const data = await pptx.write({ outputType: 'nodebuffer' });
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, data);
}

/**
 * Create a file based on its extension.
 * Supports: .docx, .xlsx, .pptx, and plain text files.
 */
async function createFile(filePath, title) {
  const ext = path.extname(filePath).toLowerCase();

  switch (ext) {
    case '.docx':
      await createDocx(filePath, title);
      break;
    case '.xlsx':
      await createXlsx(filePath, title);
      break;
    case '.pptx':
      await createPptx(filePath, title);
      break;
    default:
      // Plain text / markdown / other
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, '', 'utf-8');
      break;
  }
}

module.exports = { createFile, createDocx, createXlsx, createPptx };
