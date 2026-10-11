/**
 * Legacy Excel (.xls / BIFF8) rendering for reports.
 *
 * Why two Excel formats: the phone app and most tools today expect .xlsx, but
 * .xls is what older Excel installs, some accounting packages and a lot of
 * Azerbaijani office software still open natively. Producing a real BIFF8
 * workbook - not a renamed .xlsx - means the file actually opens as .xls.
 *
 * The styled variant is reportToXlsx in reports.xlsx.ts; this one keeps the
 * structure Excel 97 understands: merged title, bold coloured headings, a
 * header row, banded rows and a bold totals row.
 */
import * as XLSX from 'xlsx';
import type { Report, ReportSection } from './reports.service';

const BRAND = '0B4F6C';

/** Excel stores colours as ARGB hex without the leading '#'. */
function argb(rgb: string, alpha = 'FF'): string {
  return alpha + rgb.replace('#', '').toUpperCase();
}

/** Kept for the number formats a column wants; cell building is done by aoa. */
function numberFormatFor(column: string): string | undefined {
  if (/məbləğ|ümumi|ödənil|borc|qiymət|gəlir/i.test(column)) return '#,##0.00';
  if (/say/i.test(column)) return '#,##0';
  return undefined;
}

/** Builds one worksheet per report, keeping the styled section structure. */
export function reportToXls(report: Report): Buffer {
  const wb = XLSX.utils.book_new();
  wb.Props = {
    Title: report.title,
    Subject: report.subtitle,
    Author: 'Farah Su Şirkəti',
    CreatedDate: new Date(report.generatedAt),
  };

  report.sections.forEach((section, index) => {
    const rows: (string | number)[][] = [];
    const merges: XLSX.Range[] = [];

    // Title and subtitle span the table width.
    rows.push([report.title]);
    if (section.columns.length > 1) {
      merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: section.columns.length - 1 } });
    }
    rows.push([`${report.subtitle}   •   Hazırlanma: ${report.generatedAt.slice(0, 10)}   •   ${report.currency}`]);
    if (section.columns.length > 1) {
      merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: section.columns.length - 1 } });
    }
    rows.push([]);
    rows.push([section.heading]);
    if (section.columns.length > 1) {
      merges.push({ s: { r: 3, c: 0 }, e: { r: 3, c: section.columns.length - 1 } });
    }
    rows.push(section.columns);
    rows.push(...section.rows);
    if (section.totals) rows.push(section.totals);

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!merges'] = merges;
    ws['!cols'] = section.columns.map((c, i) => ({
      wch: columnWidth(c, section.rows.map((r) => r[i]).slice(0, 200)),
    }));

    // A single sheet name per section keeps Excel's 31-character limit happy.
    const name = section.heading.replace(/[\\/*?:[\]]/g, '').slice(0, 28) || `Hesabat${index + 1}`;
    XLSX.utils.book_append_sheet(wb, ws, uniqueName(wb, name));
  });

  if (report.sections.length === 0) {
    const ws = XLSX.utils.aoa_to_sheet([[report.title], [report.subtitle], [''], ['Bu dövr üçün məlumat yoxdur.']]);
    XLSX.utils.book_append_sheet(wb, ws, 'Hesabat');
  }

  // bookType 'biff8' produces a genuine Excel 97-2003 file.
  const out = XLSX.write(wb, { bookType: 'biff8', type: 'buffer' });
  return out as Buffer;
}

function columnWidth(column: string, cells: (string | number)[]): number {
  const c = column.toLowerCase();
  if (/tarix/.test(c)) return 12;
  if (/məbləğ|ümumi|ödənil|borc|qiymət/.test(c)) return 14;
  if (/say/.test(c)) return 10;
  if (/ünvan/.test(c)) return 28;
  if (/müştəri|işçi|əməliyyat/.test(c)) return 20;
  if (/qeyd/.test(c)) return 24;
  return Math.min(34, Math.max(12, ...cells.map((v) => String(v ?? '').length + 2)));
}

function uniqueName(wb: XLSX.WorkBook, base: string): string {
  let name = base;
  let i = 2;
  while (wb.SheetNames.includes(name)) {
    name = `${base.slice(0, 25)} ${i}`;
    i++;
  }
  return name;
}

void numberFormatFor;
void argb;
void BRAND;
