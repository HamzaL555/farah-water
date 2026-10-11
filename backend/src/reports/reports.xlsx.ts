/**
 * Excel (.xlsx) rendering for reports.
 *
 * Separate from reports.service.ts on purpose: ExcelJS pulls in a large
 * dependency tree and is only needed on the export path, so the JSON/CSV
 * reports do not pay for it.
 *
 * The output is styled rather than a raw dump: titled header block, coloured
 * section headings, banded rows, a bold totals row, right-aligned money with
 * a thousands separator, and frozen panes so long tables stay readable.
 */
import ExcelJS from 'exceljs';
import type { Report, ReportSection } from './reports.service';

const BRAND = 'FF0B4F6C';
const BRAND_DARK = 'FF073A50';
const HEADING_BG = 'FFE3F2FD';
const TOTAL_BG = 'FFDCEBF5';
const BAND_BG = 'FFF7FAFC';
const GRID = 'FFD8E2E8';

/** Azerbaijani month names, used for the "Oktyabr 2026" subtitle. */
const MONTHS = [
  'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'İyun',
  'İyul', 'Avqust', 'Sentyabr', 'Oktyabr', 'Noyabr', 'Dekabr',
];

export function monthName(index: number): string {
  return MONTHS[index] ?? '';
}

/**
 * Column widths that suit the actual content of each report table.
 * Indexed by column name so every report gets sensible sizes without hand
 * tuning a dozen different layouts.
 */
function widthFor(column: string, cells: (string | number)[]): number {
  const c = column.toLowerCase();
  if (/tarix/.test(c)) return 12;
  if (/məbləğ|ümumi|ödənil|borc|qiymət/.test(c)) return 14;
  if (/say/.test(c)) return 10;
  if (/ünvan/.test(c)) return 28;
  if (/müştəri|işçi|əməliyyat/.test(c)) return 20;
  if (/qeyd/.test(c)) return 24;
  if (/telefon/.test(c)) return 16;
  if (/status|üsul/.test(c)) return 16;
  // Fall back to the widest rendered value in that column.
  return Math.min(34, Math.max(12, ...cells.map((v) => String(v ?? '').length + 2)));
}

/** Money columns get thousands separators; everything else stays plain. */
function isMoneyColumn(column: string): boolean {
  return /məbləğ|ümumi|ödənil|borc|qiymət|gəlir/.test(column.toLowerCase());
}

function isCountColumn(column: string): boolean {
  return /say/.test(column.toLowerCase());
}

export async function reportToXlsx(report: Report): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Farah Su Şirkəti';
  wb.created = new Date(report.generatedAt);

  const ws = wb.addWorksheet('Hesabat', {
    views: [{ showGridLines: false }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const sectionCount = report.sections.length || 1;
  // Title, subtitle, generated line, blank, then a heading + header + N rows
  // per section. The width is fixed up front so merges span the whole table.
  const guessCols = Math.max(2, ...report.sections.map((s) => s.columns.length));

  // ------------------------------- header ----------------------------------
  const titleRow = ws.getRow(1);
  titleRow.height = 26;
  ws.mergeCells(1, 1, 1, guessCols);
  const titleCell = titleRow.getCell(1);
  titleCell.value = report.title;
  titleCell.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' }, name: 'Calibri' };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

  const subRow = ws.getRow(2);
  subRow.height = 18;
  ws.mergeCells(2, 1, 2, guessCols);
  const subCell = subRow.getCell(1);
  subCell.value = `${report.subtitle}   •   Hazırlanma: ${report.generatedAt.slice(0, 10)}   •   ${report.currency}`;
  subCell.font = { size: 10, color: { argb: 'FFFFFFFF' } };
  subCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_DARK } };
  subCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

  let row = 4;

  // ------------------------------- sections --------------------------------
  report.sections.forEach((section: ReportSection, index) => {
    const cols = section.columns.length;

    // Section heading
    const headRow = ws.getRow(row);
    ws.mergeCells(row, 1, row, guessCols);
    const headCell = headRow.getCell(1);
    headCell.value = section.heading;
    headCell.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
    headCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
    headCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    headRow.height = 20;
    row += 1;

    // Column headers
    const headerRow = ws.getRow(row);
    headerRow.height = 18;
    section.columns.forEach((c, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = c;
      cell.font = { bold: true, size: 10, color: { argb: BRAND_DARK } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADING_BG } };
      cell.alignment = {
        vertical: 'middle',
        horizontal: isMoneyColumn(c) || isCountColumn(c) ? 'right' : 'left',
        wrapText: true,
      };
      cell.border = {
        top: { style: 'thin', color: { argb: GRID } },
        bottom: { style: 'thin', color: { argb: GRID } },
        left: { style: 'hair', color: { argb: GRID } },
        right: { style: 'hair', color: { argb: GRID } },
      };
    });
    row += 1;

    // Body
    const bodyStart = row;
    section.rows.forEach((r, rIdx) => {
      const dataRow = ws.getRow(row);
      r.forEach((value, cIdx) => {
        const cell = dataRow.getCell(cIdx + 1);
        // Numbers stay numeric so Excel can total them; only text is escaped.
        cell.value = typeof value === 'number' ? value : String(value ?? '');
        const col = section.columns[cIdx] ?? '';
        cell.font = { size: 10 };
        cell.alignment = {
          vertical: 'middle',
          horizontal: typeof value === 'number' ? 'right' : 'left',
        };
        if (isMoneyColumn(col) && typeof value === 'number') {
          cell.numFmt = '#,##0.00';
        } else if (isCountColumn(col) && typeof value === 'number') {
          cell.numFmt = '#,##0';
        }
        if (rIdx % 2 === 1) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND_BG } };
        }
        cell.border = {
          top: { style: 'hair', color: { argb: GRID } },
          bottom: { style: 'hair', color: { argb: GRID } },
          left: { style: 'hair', color: { argb: GRID } },
          right: { style: 'hair', color: { argb: GRID } },
        };
      });
      row += 1;
    });

    // Totals
    if (section.totals) {
      const totalRow = ws.getRow(row);
      section.totals.forEach((value, cIdx) => {
        const cell = totalRow.getCell(cIdx + 1);
        cell.value = typeof value === 'number' ? value : String(value ?? '');
        cell.font = { bold: true, size: 10, color: { argb: BRAND_DARK } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTAL_BG } };
        cell.alignment = {
          vertical: 'middle',
          horizontal: typeof value === 'number' ? 'right' : 'left',
        };
        const col = section.columns[cIdx] ?? '';
        if (isMoneyColumn(col) && typeof value === 'number') cell.numFmt = '#,##0.00';
        else if (isCountColumn(col) && typeof value === 'number') cell.numFmt = '#,##0';
        cell.border = {
          top: { style: 'thin', color: { argb: BRAND } },
          bottom: { style: 'double', color: { argb: BRAND } },
          left: { style: 'hair', color: { argb: GRID } },
          right: { style: 'hair', color: { argb: GRID } },
        };
      });
      row += 1;
    }

    // Column widths, and freeze the first data row of the first section so the
    // header stays visible while scrolling a long table.
    section.columns.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      const cells = section.rows.map((r) => r[i]).slice(0, 200);
      const w = widthFor(c, cells);
      if (index === 0 || !col.width || w > col.width) col.width = w;
    });

    if (index === 0 && section.rows.length > 0) {
      ws.views = [{ state: 'frozen', ySplit: row - 1 - section.rows.length, showGridLines: false }];
    }

    row += 2;
    void bodyStart;
  });

  // A single summary line makes an empty report legible instead of blank.
  if (report.sections.length === 0) {
    ws.getRow(4).getCell(1).value = 'Bu dövr üçün məlumat yoxdur.';
  }

  void sectionCount;

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
