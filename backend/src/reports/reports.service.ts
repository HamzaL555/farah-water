import { DeliveryStatus, InventoryTxType, Prisma, PaymentMethod, Role } from '@prisma/client';
import PDFDocument from 'pdfkit';
import path from 'path';
import { prisma } from '../prisma';
import { forbidden } from '../common/utils/errors';
import { resolveRange, DateRangePreset, formatDDMMYYYY, formatTimeHHMM } from '../common/utils/date';
import { WAREHOUSE_KEY, workerKey } from '../inventory/inventory.service';
import { Actor } from '../users/users.service';

const D = (v: Prisma.Decimal | null | undefined) => Number((v ?? new Prisma.Decimal(0)).toFixed(2));

export type ReportType = 'daily' | 'period' | 'worker' | 'customer' | 'inventory' | 'payments' | 'deliveries';

export interface ReportRequest {
  type: ReportType;
  preset?: DateRangePreset;
  from?: string;
  to?: string;
  workerId?: string;
  customerId?: string;
}

export interface ReportSection {
  heading: string;
  columns: string[];
  rows: (string | number)[][];
  totals?: (string | number)[];
}

export interface Report {
  title: string;
  subtitle: string;
  generatedAt: string;
  currency: string;
  sections: ReportSection[];
}

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  CASH: 'Nağd',
  CARD: 'Kart',
  TRANSFER: 'Köçürmə',
  OTHER: 'Digər',
};

const DELIVERY_STATUS_LABEL: Record<string, string> = {
  UNPAID: 'Ödənilməyib',
  PARTIAL: 'Qismən ödənilib',
  PAID: 'Ödənilib',
  CANCELLED: 'Ləğv edilib',
};

const INVENTORY_TYPE_LABEL: Record<string, string> = {
  INBOUND: 'Anbara daxil',
  ISSUE_TO_WORKER: 'İşçiyə təhvil',
  OUT_DELIVERY: 'Çatdırılma',
  RETURN_TO_STOCK: 'Anbara qaytarılma',
  DAMAGE: 'Zədələnmiş',
  LOSS: 'İtmiş',
  CORRECTION: 'Düzəliş',
};

const WATER_TYPE_LABEL: Record<string, string> = {
  FILTERED: 'Filtr suyu',
  SPRING: 'Bulaq suyu',
};

const MAX_ROWS = 5000;

/** Builds the full report dataset (format-agnostic). */
export async function buildReport(req: ReportRequest, actor: Actor): Promise<Report> {
  const { start, end } = resolveRange(req.preset, req.from ? new Date(req.from) : null, req.to ? new Date(req.to) : null);
  const rangeLabel = start && end ? `${formatDDMMYYYY(start)} - ${formatDDMMYYYY(new Date(end.getTime() - 86_400_000))}` : 'Bütün dövrlər';
  const range = { start, end };

  // Workers may only ever report on themselves.
  const workerId = actor.role === Role.ADMIN ? req.workerId : actor.id;

  const scopeWorker = <T extends Prisma.DeliveryWhereInput>(w: T): T =>
    (workerId ? { ...w, workerId } : w) as T;

  const sections: ReportSection[] = [];

  // ------------------------- money summary --------------------------------
  const paymentsAgg = await prisma.payment.aggregate({
    where: {
      voidedAt: null,
      ...(workerId ? { workerId } : {}),
      ...(req.customerId ? { customerId: req.customerId } : {}),
      ...(start || end ? { paidAt: { ...(start ? { gte: start } : {}), ...(end ? { lt: end } : {}) } } : {}),
    },
    _sum: { amount: true },
    _count: { _all: true },
  });

  const billedAgg = await prisma.delivery.aggregate({
    where: scopeWorker({
      status: { not: DeliveryStatus.CANCELLED },
      ...(req.customerId ? { customerId: req.customerId } : {}),
      ...(start || end ? { deliveredAt: { ...(start ? { gte: start } : {}), ...(end ? { lt: end } : {}) } } : {}),
    }),
    _sum: { totalAmount: true, paidAmount: true, debtAmount: true, bottleCount: true },
    _count: { _all: true },
  });

  sections.push({
    heading: 'Maliyyə xülasəsi',
    columns: ['Göstərici', 'Qiymət'],
    rows: [
      ['Faktiki daxil olan ödəniş (gəlir)', D(paymentsAgg._sum.amount)],
      ['Ödəniş sayı', paymentsAgg._count._all],
      ['Çatdırılmış məbləğ ( faktura)', D(billedAgg._sum.totalAmount)],
      ['Çatdırılmış bidon sayı', billedAgg._sum.bottleCount ?? 0],
      ['Çatdırılma sayı', billedAgg._count._all],
      ['Qalan borc', D(billedAgg._sum.debtAmount)],
    ],
  });

  // --------------------------- deliveries ---------------------------------
  if (req.type === 'daily' || req.type === 'period' || req.type === 'deliveries' || req.type === 'worker') {
    const deliveries = await prisma.delivery.findMany({
      where: scopeWorker({
        ...(req.customerId ? { customerId: req.customerId } : {}),
        ...(start || end ? { deliveredAt: { ...(start ? { gte: start } : {}), ...(end ? { lt: end } : {}) } } : {}),
      }),
      orderBy: { deliveredAt: 'desc' },
      take: MAX_ROWS,
      include: {
        customer: { select: { name: true } },
        worker: { select: { fullName: true } },
        company: { select: { name: true } },
        office: { select: { name: true } },
      },
    });

    sections.push({
      heading: 'Çatdırılmalar',
      columns: [
        'Tarix', 'Saat', 'Su', 'Hara', 'Müştəri', 'Ünvan / Ofis', 'İşçi',
        'Bidon', 'Qiymət', 'Ümumi', 'Ödənilən', 'Borc', 'Status',
      ],
      rows: deliveries.map((d) => [
        formatDDMMYYYY(d.deliveredAt),
        // The clock time matters when two drops land on the same day and the
        // owner needs to know which driver reported in first.
        formatTimeHHMM(d.deliveredAt),
        WATER_TYPE_LABEL[d.waterType] ?? d.waterType,
        d.destinationType === 'COMPANY'
          ? `${d.company?.name ?? ''}${d.office ? ` - ${d.office.name}` : ''}`.trim()
          : 'Ev',
        d.customer.name,
        d.address,
        d.worker.fullName,
        d.bottleCount,
        D(d.unitPrice),
        D(d.totalAmount),
        D(d.paidAmount),
        D(d.debtAmount),
        DELIVERY_STATUS_LABEL[d.status] ?? d.status,
      ]),
      totals: [
        'CƏMİ', '', '', '', '', '', '',
        deliveries.reduce((s, d) => s + d.bottleCount, 0),
        '',
        D(deliveries.reduce((s, d) => s.plus(d.totalAmount), new Prisma.Decimal(0))),
        D(deliveries.reduce((s, d) => s.plus(d.paidAmount), new Prisma.Decimal(0))),
        D(deliveries.reduce((s, d) => s.plus(d.debtAmount), new Prisma.Decimal(0))),
        '',
      ],
    });
  }

  // ---------------------------- payments ----------------------------------
  if (req.type === 'daily' || req.type === 'period' || req.type === 'payments' || req.type === 'worker') {
    const payments = await prisma.payment.findMany({
      where: {
        ...(workerId ? { workerId } : {}),
        ...(req.customerId ? { customerId: req.customerId } : {}),
        ...(start || end ? { paidAt: { ...(start ? { gte: start } : {}), ...(end ? { lt: end } : {}) } } : {}),
      },
      orderBy: { paidAt: 'desc' },
      take: MAX_ROWS,
      include: { customer: { select: { name: true } }, recordedBy: { select: { fullName: true } } },
    });

    sections.push({
      heading: 'Ödəniş tarixçəsi',
      columns: ['Tarix', 'Müştəri', 'Məbləğ', 'Üsul', 'Qeyd', 'Qeyd edən', 'Status'],
      rows: payments.map((p) => [
        formatDDMMYYYY(p.paidAt),
        p.customer.name,
        D(p.amount),
        PAYMENT_METHOD_LABEL[p.method] ?? p.method,
        p.note ?? '',
        p.recordedBy.fullName,
        p.voidedAt ? 'Geri qaytarılıb' : 'Qeydə alınıb',
      ]),
      totals: [
        'CƏMİ', '',
        D(payments.filter((p) => !p.voidedAt).reduce((s, p) => s.plus(p.amount), new Prisma.Decimal(0))),
        '', '', '', '',
      ],
    });
  }

  // --------------------------- debts --------------------------------------
  if (req.type === 'period' || req.type === 'customer' || req.type === 'worker' || req.type === 'deliveries') {
    const debts = await prisma.delivery.groupBy({
      by: ['customerId'],
      where: scopeWorker({
        debtAmount: { gt: 0 },
        status: { not: DeliveryStatus.CANCELLED },
        ...(req.customerId ? { customerId: req.customerId } : {}),
        ...(start || end ? { deliveredAt: { ...(start ? { gte: start } : {}), ...(end ? { lt: end } : {}) } } : {}),
      }),
      _sum: { debtAmount: true, totalAmount: true, paidAmount: true },
      _count: { _all: true },
    });

    const customers = await prisma.customer.findMany({
      where: { id: { in: debts.map((d) => d.customerId) } },
      select: { id: true, name: true, phone: true, address: true },
    });
    const byId = new Map(customers.map((c) => [c.id, c]));

    sections.push({
      heading: 'Müştəri üzrə borc hesabatı',
      columns: ['Müştəri', 'Telefon', 'Ünvan', 'Çatdırılma', 'Ümumi', 'Ödənilən', 'Qalan borc'],
      rows: debts
        .map((d) => {
          const c = byId.get(d.customerId);
          return [
            c?.name ?? 'Bilinməyən',
            c?.phone ?? '',
            c?.address ?? '',
            d._count._all,
            D(d._sum.totalAmount),
            D(d._sum.paidAmount),
            D(d._sum.debtAmount),
          ] as (string | number)[];
        })
        .sort((a, b) => Number(b[6]) - Number(a[6])),
      totals: [
        'CƏMİ', '', '', '',
        D(debts.reduce((s, d) => s.plus(d._sum.totalAmount ?? 0), new Prisma.Decimal(0))),
        D(debts.reduce((s, d) => s.plus(d._sum.paidAmount ?? 0), new Prisma.Decimal(0))),
        D(debts.reduce((s, d) => s.plus(d._sum.debtAmount ?? 0), new Prisma.Decimal(0))),
      ],
    });
  }

  // -------------------------- inventory -----------------------------------
  if (req.type === 'inventory' || req.type === 'period') {
    const [warehouse, workerBalances, movements] = await Promise.all([
      prisma.inventoryBalance.findUnique({ where: { key: WAREHOUSE_KEY }, select: { quantity: true } }),
      prisma.inventoryBalance.findMany({
        where: { scope: 'WORKER' },
        include: { worker: { select: { fullName: true, username: true } } },
        orderBy: { quantity: 'desc' },
      }),
      prisma.inventoryTransaction.findMany({
        where: {
          ...(workerId ? { OR: [{ workerId }, { balanceKey: WAREHOUSE_KEY }] } : {}),
          ...(start || end ? { occurredAt: { ...(start ? { gte: start } : {}), ...(end ? { lt: end } : {}) } } : {}),
        },
        orderBy: { occurredAt: 'desc' },
        take: MAX_ROWS,
        include: { worker: { select: { fullName: true } } },
      }),
    ]);

    sections.push({
      heading: 'Anbar vəziyyəti',
      columns: ['Sahə', 'Say'],
      rows: [
        ['Anbarda qalan bidon', warehouse?.quantity ?? 0],
        ['İşçilərin əlindəki bidonlar', workerBalances.reduce((s, b) => s + b.quantity, 0)],
        ...workerBalances.filter((b) => b.worker).map((b) => [`  - ${b.worker!.fullName} (${b.worker!.username})`, b.quantity]),
      ],
    });

    sections.push({
      heading: 'İnventar tarixçəsi',
      columns: ['Tarix', 'Saat', 'Əməliyyat', 'Say', 'İşçi', 'Qeyd'],
      rows: movements.map((m) => [
        formatDDMMYYYY(m.occurredAt),
        formatTimeHHMM(m.occurredAt),
        INVENTORY_TYPE_LABEL[m.type] ?? m.type,
        `${m.direction > 0 ? '+' : '-'}${m.bottleCount}`,
        m.worker?.fullName ?? '',
        m.note ?? '',
      ]),
    });
  }

  const titleMap: Record<ReportType, string> = {
    daily: 'Günlük hesabat',
    period: 'Dövri hesabat',
    worker: 'İşçi üzrə hesabat',
    customer: 'Müştəri borc hesabatı',
    inventory: 'Anbar hesabatı',
    payments: 'Ödəniş tarixçəsi',
    deliveries: 'Çatdırılma hesabatı',
  };

  return {
    title: titleMap[req.type] ?? 'Hesabat',
    subtitle: rangeLabel,
    generatedAt: new Date().toISOString(),
    currency: process.env.CURRENCY ?? 'AZN',
    sections,
  };
}

/**
 * Aylıq və illik xlsx / xls exportu üçün əlavə bölüş hissələri.
 *
 * `rows` — «Çatdırılmalar» hissəsinin satelləri (Tarix=0, Bidon=7, Ümumi=9,
 * Ödənilən=10, Borc=11). Yaş extracti «DD.MM.YYYY».
 */
export function breakdownSections(title: string, rows: (string | number)[][]): ReportSection[] {
  const out: ReportSection[] = [];
  if (!rows.length) return out;

  const toNum = (v: string | number): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  const totalRow = (label: string, groups: { c: number; b: number; t: number; p: number; d: number }[]) =>
    [
      label,
      groups.reduce((s, g) => s + g.c, 0),
      groups.reduce((s, g) => s + g.b, 0),
      groups.reduce((s, g) => s + g.t, 0),
      groups.reduce((s, g) => s + g.p, 0),
      groups.reduce((s, g) => s + g.d, 0),
    ] as (string | number)[];

  if (title.startsWith('Aylıq hesabat')) {
    const map = new Map<string, { c: number; b: number; t: number; p: number; d: number }>();
    for (const r of rows) {
      const date = String(r[0] ?? '');
      let e = map.get(date);
      if (!e) { e = { c: 0, b: 0, t: 0, p: 0, d: 0 }; map.set(date, e); }
      e.c += 1;
      e.b += toNum(r[7]);
      e.t += toNum(r[9]);
      e.p += toNum(r[10]);
      e.d += toNum(r[11]);
    }
    const data = [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, e]) => [date, e.c, e.b, e.t, e.p, e.d] as (string | number)[]);
    out.push({
      heading: 'Günlük bölüş',
      columns: ['Tarix', 'Çatdırılma', 'Bidon', 'Ümumi', 'Gəlir', 'Borc'],
      rows: data,
      totals: totalRow('GÜN CƏMİ', data.map((r) => ({ c: Number(r[1]), b: Number(r[2]), t: Number(r[3]), p: Number(r[4]), d: Number(r[5]) }))),
    });
  }

  if (title.startsWith('İllik hesabat')) {
    const MONTHS = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'İyun', 'İyul', 'Avqust', 'Sentyabr', 'Oktyabr', 'Noyabr', 'Dekabr'];
    const map = new Map<number, { c: number; b: number; t: number; p: number; d: number }>();
    for (const r of rows) {
      const date = String(r[0] ?? '');
      const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(date);
      if (!m) continue;
      const mon = +m[2];
      if (mon < 1 || mon > 12) continue;
      let e = map.get(mon);
      if (!e) { e = { c: 0, b: 0, t: 0, p: 0, d: 0 }; map.set(mon, e); }
      e.c += 1;
      e.b += toNum(r[7]);
      e.t += toNum(r[9]);
      e.p += toNum(r[10]);
      e.d += toNum(r[11]);
    }
    const data = MONTHS.map((name, i) => {
      const e = map.get(i + 1) ?? { c: 0, b: 0, t: 0, p: 0, d: 0 };
      return [name, e.c, e.b, e.t, e.p, e.d] as (string | number)[];
    });
    out.push({
      heading: 'Aylıq bölüş',
      columns: ['Ay', 'Çatdırılma', 'Bidon', 'Ümumi', 'Gəlir', 'Borc'],
      rows: data,
      totals: totalRow('İL CƏMİ', data.map((r) => ({ c: Number(r[1]), b: Number(r[2]), t: Number(r[3]), p: Number(r[4]), d: Number(r[5]) }))),
    });
  }

  return out;
}

// ============================== CSV =======================================

function csvCell(value: string | number): string {
  const s = String(value ?? '');
  // Quote when the cell could otherwise break the row/column structure.
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * UTF-8 with BOM so Excel on Windows opens Azerbaijani characters correctly.
 * Semicolons are used as separators because Azerbaijani Windows locales default
 * to `;` in the CSV import wizard.
 */
export function reportToCsv(report: Report): string {
  const lines: string[] = [];
  lines.push(csvCell(report.title));
  lines.push(csvCell(report.subtitle));
  lines.push(csvCell('Hazırlanma tarixi'), csvCell(formatDDMMYYYY(report.generatedAt)));
  lines.push('');

  for (const section of report.sections) {
    lines.push(csvCell(section.heading));
    lines.push(section.columns.map(csvCell).join(';'));
    for (const row of section.rows) lines.push(row.map(csvCell).join(';'));
    if (section.totals) lines.push(section.totals.map(csvCell).join(';'));
    lines.push('');
  }

  return '\uFEFF' + lines.join('\r\n');
}

// ============================== PDF =======================================

const FONT_CANDIDATES = [
  path.resolve(__dirname, '../../assets/fonts/DejaVuSans.ttf'),
  path.resolve(__dirname, '../../../assets/fonts/DejaVuSans.ttf'),
  'C:/Windows/Fonts/arial.ttf',
  'C:/Windows/Fonts/calibri.ttf',
];

function resolveFont(): string | null {
  const fs = require('fs') as typeof import('fs');
  for (const candidate of FONT_CANDIDATES) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/**
 * Renders the report to a PDF buffer.
 *
 * A Unicode font is mandatory: Azerbaijani text contains ə/ğ/ı/ş which are
 * absent from PDFKit's built-in WinAnsi fonts and would throw at write time.
 */
export function reportToPdf(report: Report): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 32, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const font = resolveFont();
    const setFont = (size: number, bold = false) => {
      if (!font) return;
      doc.font(font).fontSize(size);
      void bold;
    };

    const usable = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const colWidth = (n: number) => usable / n;

    // header
    setFont(18);
    doc.fillColor('#0B4F6C').text(report.title, { align: 'left' });
    setFont(11);
    doc.fillColor('#333').text(`Dövr: ${report.subtitle}`);
    doc.text(`Hazırlanma: ${formatDDMMYYYY(report.generatedAt)} ${new Date(report.generatedAt).toTimeString().slice(0, 5)}`);
    doc.moveDown(0.8);

    for (const section of report.sections) {
      setFont(13);
      doc.fillColor('#0B4F6C').text(section.heading);
      doc.moveDown(0.3);

      if (font) doc.font(font).fontSize(7.5);
      doc.fillColor('#FFFFFF');
      const headerY = doc.y;
      section.columns.forEach((c, i) => {
        doc.rect(doc.page.margins.left + i * colWidth(section.columns.length), headerY, colWidth(section.columns.length), 16).fill('#0B4F6C');
      });
      doc.fillColor('#FFFFFF');
      section.columns.forEach((c, i) => {
        doc.text(c, doc.page.margins.left + i * colWidth(section.columns.length) + 3, headerY + 4, {
          width: colWidth(section.columns.length) - 6,
          align: i === 0 ? 'left' : 'right',
          lineBreak: false,
        });
      });
      doc.y = headerY + 16;
      doc.fillColor('#111');

      const renderRow = (row: (string | number)[], bold: boolean, bg: string | null) => {
        if (doc.y > doc.page.height - 60) {
          doc.addPage();
        }
        const y = doc.y;
        const width = colWidth(row.length);
        if (bg) {
          doc.rect(doc.page.margins.left, y, usable, 14).fill(bg);
        }
        doc.fillColor(bold ? '#0B4F6C' : '#111');
        if (font) doc.font(font).fontSize(7.5);
        row.forEach((cell, i) => {
          const isNumber = typeof cell === 'number';
          doc.text(String(cell ?? ''), doc.page.margins.left + i * width + 3, y + 3.5, {
            width: width - 6,
            align: i === 0 || !isNumber ? 'left' : 'right',
            lineBreak: false,
            ellipsis: true,
          });
        });
        doc.y = y + 14;
      };

      for (const row of section.rows) renderRow(row, false, null);
      if (section.totals) renderRow(section.totals, true, '#E3F2FD');

      doc.moveDown(0.9);
    }

    // page numbers
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      if (font) doc.font(font).fontSize(8);
      doc.fillColor('#888').text(
        `Farah Su Şirkəti • Səhifə ${i - range.start + 1} / ${range.count}`,
        doc.page.margins.left,
        doc.page.height - 28,
        { width: usable, align: 'center' },
      );
    }

    doc.end();
  });
}
