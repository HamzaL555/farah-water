import { Router } from 'express';
import { asyncHandler } from '../common/middleware/error';
import { requireAuth } from '../common/middleware/auth';
import { validate } from '../common/middleware/validate';
import { actorOf } from '../common/utils/actor';
import { reportSchema } from '../common/schemas';
import { buildReport, breakdownSections, reportToCsv, reportToPdf } from './reports.service';
import { reportToXlsx, monthName } from './reports.xlsx';
import { reportToXls } from './reports.xls';
import { startOfLocalMonth, endOfLocalMonth, startOfLocalYear, endOfLocalYear, tzOffsetMinutes } from '../common/utils/date';

export const reportsRouter = Router();
reportsRouter.use(requireAuth);

/**
 * Renders one bounded period as a report in the requested format.
 *
 * Daily, monthly and yearly reports are the same dataset over a different
 * range; only the label and the range differ. Keeping the range resolution
 * here means the phone and the web cannot drift apart on what "this month"
 * means, which is the whole reason these are endpoints rather than a date
 * pair built by the client.
 */
async function sendPeriodReport(
  res: Parameters<Parameters<typeof asyncHandler>[0]>[1],
  req: Parameters<Parameters<typeof asyncHandler>[0]>[0],
  opts: { start: Date; end: Date; title: string; base: string; meta: Record<string, unknown> },
) {
  const actor = actorOf(req);
  const format = (req.query as { format?: string }).format ?? 'json';

  // buildReport resolves its range with `new Date(from)`, which cannot parse a
  // DD.MM.YYYY display string. Pass the instants directly instead.
  const report = await buildReport(
    {
      type: 'period',
      from: opts.start.toISOString(),
      to: new Date(opts.end.getTime() - 86_400_000).toISOString(),
    },
    actor,
  );
  report.title = opts.title;

  // Excel variantlar üçün ay / gün bölüşü hissələri (requirement 6.1 və 6.2).
  if (format === 'xlsx' || format === 'xls') {
    const delSection = report.sections.find((s) => s.heading === 'Çatdırılmalar');
    report.sections.push(
      ...breakdownSections(report.title, delSection ? delSection.rows : []),
    );
  }

  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${opts.base}.csv"`);
    res.send(reportToCsv(report));
    return;
  }
  if (format === 'pdf') {
    const buffer = await reportToPdf(report);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${opts.base}.pdf"`);
    res.end(buffer);
    return;
  }
  if (format === 'xlsx') {
    const buffer = await reportToXlsx(report);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${opts.base}.xlsx"`);
    res.end(buffer);
    return;
  }
  if (format === 'xls') {
    const buffer = reportToXls(report);
    res.setHeader('Content-Type', 'application/vnd.ms-excel');
    res.setHeader('Content-Disposition', `attachment; filename="${opts.base}.xls"`);
    res.end(buffer);
    return;
  }

  res.json({ data: report, meta: opts.meta });
}

/**
 * Monthly report.
 *
 * A first-class endpoint rather than a client-side date pair, because "this
 * month" has to mean the same local calendar month on the phone and on the
 * web. `?month=YYYY-MM` selects the month; omitting it means the current one,
 * and `?month=last` means the previous one.
 */
reportsRouter.get(
  '/monthly',
  // `month` must survive validation: Zod strips unrecognised keys, so picking
  // only `format` would silently drop it and every request would answer with
  // the current month.
  validate(reportSchema.pick({ format: true, month: true }), 'query'),
  asyncHandler(async (req, res) => {
    const { month } = req.query as { month?: string };

    let anchor: Date;
    if (month === 'last') {
      // Step back one month from the first of this month, so a 31-day month
      // cannot skip a month when the day-of-month is past the 28th.
      const thisMonth = startOfLocalMonth();
      anchor = new Date(thisMonth.getTime());
      anchor.setUTCDate(0);
    } else if (month && /^\d{4}-\d{2}$/.test(month)) {
      const [y, m] = month.split('-').map(Number);
      anchor = new Date(Date.UTC(y, m - 1, 1));
    } else {
      // No `month` given means the current month. It must still produce a
      // bounded range, otherwise the report would silently cover all time.
      anchor = startOfLocalMonth();
    }

    // Use the shared local-month helpers so a serverless function always
    // resolves "the 1st" in Baku time, regardless of the host's own timezone.
    const start = startOfLocalMonth(anchor);
    const end = endOfLocalMonth(anchor);

    const local = new Date(anchor.getTime() + tzOffsetMinutes() * 60_000);
    const label = `${monthName(local.getUTCMonth())} ${local.getUTCFullYear()}`;

    await sendPeriodReport(res, req, {
      start,
      end,
      title: `Aylıq hesabat — ${label}`,
      base: `ayliq-hesabat-${label.toLowerCase().replace(/\s+/g, '-')}`,
      meta: { month: label },
    });
  }),
);

/**
 * Yearly report. Same reasoning as `/monthly`: `?year=YYYY` selects the year,
 * `?year=last` the previous one, omitted means the current year. Always
 * bounded - an unbounded year would silently become "all time".
 */
reportsRouter.get(
  '/yearly',
  validate(reportSchema.pick({ format: true, year: true }), 'query'),
  asyncHandler(async (req, res) => {
    const { year } = req.query as { year?: string };

    const thisYear = startOfLocalYear();
    let anchor: Date;
    if (year === 'last') {
      anchor = new Date(thisYear.getTime());
      anchor.setUTCFullYear(anchor.getUTCFullYear() - 1);
    } else if (year && /^\d{4}$/.test(year)) {
      anchor = new Date(Date.UTC(Number(year), 0, 1));
    } else {
      anchor = thisYear;
    }

    const start = startOfLocalYear(anchor);
    const end = endOfLocalYear(anchor);
    const local = new Date(anchor.getTime() + tzOffsetMinutes() * 60_000);
    const label = String(local.getUTCFullYear());

    await sendPeriodReport(res, req, {
      start,
      end,
      title: `İllik hesabat — ${label}`,
      base: `illik-hesabat-${label}`,
      meta: { year: label },
    });
  }),
);

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Renders a report in the requested format.
 * CSV and PDF are streamed as downloads so the mobile app can save and share
 * them without having to build the file itself.
 */
reportsRouter.get(
  '/',
  validate(reportSchema, 'query'),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as {
      type: 'daily' | 'period' | 'worker' | 'customer' | 'inventory' | 'payments' | 'deliveries';
      preset?: never;
      from?: string;
      to?: string;
      workerId?: string;
      customerId?: string;
      format: 'json' | 'csv' | 'pdf' | 'xlsx' | 'xls';
    };

    const report = await buildReport(query, actorOf(req));
    const base = `${slugify(report.title)}-${new Date().toISOString().slice(0, 10)}`;

    if (query.format === 'xlsx') {
      const buffer = await reportToXlsx(report);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${base}.xlsx"`);
      res.setHeader('Content-Length', String(buffer.length));
      res.end(buffer);
      return;
    }

    if (query.format === 'xls') {
      const buffer = reportToXls(report);
      res.setHeader('Content-Type', 'application/vnd.ms-excel');
      res.setHeader('Content-Disposition', `attachment; filename="${base}.xls"`);
      res.setHeader('Content-Length', String(buffer.length));
      res.end(buffer);
      return;
    }

    if (query.format === 'csv') {
      const csv = reportToCsv(report);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${base}.csv"`);
      res.send(csv);
      return;
    }

    if (query.format === 'pdf') {
      const buffer = await reportToPdf(report);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${base}.pdf"`);
      res.setHeader('Content-Length', String(buffer.length));
      res.end(buffer);
      return;
    }

    res.json({ data: report });
  }),
);
