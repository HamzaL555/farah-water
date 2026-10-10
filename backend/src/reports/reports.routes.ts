import { Router } from 'express';
import { asyncHandler } from '../common/middleware/error';
import { requireAuth } from '../common/middleware/auth';
import { validate } from '../common/middleware/validate';
import { actorOf } from '../common/utils/actor';
import { reportSchema } from '../common/schemas';
import { buildReport, reportToCsv, reportToPdf } from './reports.service';

export const reportsRouter = Router();
reportsRouter.use(requireAuth);

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
      format: 'json' | 'csv' | 'pdf';
    };

    const report = await buildReport(query, actorOf(req));
    const base = `${slugify(report.title)}-${new Date().toISOString().slice(0, 10)}`;

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
