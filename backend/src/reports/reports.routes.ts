import { Router } from 'express';
import { asyncHandler } from '../common/middleware/error';
import { requireAuth } from '../common/middleware/auth';
import { validate } from '../common/middleware/validate';
import { actorOf } from '../common/utils/actor';
import { reportSchema } from '../common/schemas';
import { buildReport, reportToCsv, reportToPdf } from './reports.service';
import { reportToXlsx, monthName } from './reports.xlsx';
import { startOfLocalMonth, endOfLocalMonth, tzOffsetMinutes } from '../common/utils/date';

export const reportsRouter = Router();
reportsRouter.use(requireAuth);

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
    const actor = actorOf(req);
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

    // buildReport resolves its range with `new Date(from)`, which cannot parse
    // the DD.MM.YYYY display string ("30.09.2026" is Invalid Date). Pass the
    // instants directly instead of formatting them.
    const report = await buildReport(
      {
        type: 'period',
        from: start.toISOString(),
        to: new Date(end.getTime() - 86_400_000).toISOString(),
      },
      actor,
    );

    // The caller asked for a monthly report, so label it as one even though the
    // underlying dataset is the same period report.
    report.title = `Aylıq hesabat — ${label}`;

    const base = `ayliq-hesabat-${label.toLowerCase().replace(/\s+/g, '-')}`;
    const format = (req.query as { format?: string }).format ?? 'json';

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${base}.csv"`);
      res.send(reportToCsv(report));
      return;
    }
    if (format === 'pdf') {
      const buffer = await reportToPdf(report);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${base}.pdf"`);
      res.end(buffer);
      return;
    }
    if (format === 'xlsx') {
      const buffer = await reportToXlsx(report);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${base}.xlsx"`);
      res.end(buffer);
      return;
    }

    res.json({ data: report, meta: { month: label } });
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
      format: 'json' | 'csv' | 'pdf' | 'xlsx';
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
