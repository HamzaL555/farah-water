import { Router } from 'express';
import { Role } from '@prisma/client';
import { prisma } from '../prisma';
import { asyncHandler } from '../common/middleware/error';
import { requireAuth, requireRole } from '../common/middleware/auth';
import { validate } from '../common/middleware/validate';
import { audit } from '../common/utils/audit';
import { actorOf, param } from '../common/utils/actor';
import { uuidParam } from '../common/schemas';

export const companiesRouter = Router();
companiesRouter.use(requireAuth);

/**
 * The company list with its offices, for the delivery form's cascading
 * picker. Open to workers: a driver picking where to deliver needs to read
 * this. Editing it is admin-only, which is the split below.
 *
 * Prices are admin-only. A worker is told what to deliver and where, and the
 * amount is the owner's business - so the number is withheld here rather than
 * merely hidden in the UI, which any client could read around.
 */
companiesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const isAdmin = actorOf(req).role === Role.ADMIN;
    const activeOnly = req.query.all !== '1';
    const rows = await prisma.company.findMany({
      where: activeOnly ? { isActive: true } : undefined,
      orderBy: { name: 'asc' },
      include: {
        offices: {
          where: activeOnly ? { isActive: true } : undefined,
          orderBy: { sortOrder: 'asc' },
          select: { id: true, name: true, sortOrder: true, isActive: true },
        },
      },
    });

    res.json({
      data: rows.map((c) => ({
        id: c.id,
        name: c.name,
        // Money leaves as a number: a Decimal would serialise as a string and
        // every client would have to parse it back. Null means "not yours to
        // see", never "free".
        filteredPrice: isAdmin ? Number(c.filteredPrice.toFixed(2)) : null,
        springPrice: isAdmin ? Number(c.springPrice.toFixed(2)) : null,
        isActive: c.isActive,
        offices: c.offices,
      })),
    });
  }),
);

companiesRouter.post(
  '/',
  requireRole(Role.ADMIN),
  asyncHandler(async (req, res) => {
    const name = String(req.body?.name ?? '').trim();
    if (name.length < 2) {
      res.status(400).json({ error: { message: 'Şirkət adı ən azı 2 simvol olmalıdır.', code: 'BAD_REQUEST' } });
      return;
    }
    const created = await prisma.company.create({
      data: {
        name,
        filteredPrice: String(req.body?.filteredPrice ?? 0),
        springPrice: String(req.body?.springPrice ?? req.body?.filteredPrice ?? 0),
      },
    });
    await audit({
      actorId: actorOf(req).id,
      actorName: actorOf(req).fullName,
      actorRole: actorOf(req).role,
      action: 'company.created',
      entityType: 'company',
      entityId: created.id,
      after: { name: created.name },
      req: req as never,
    });
    res.status(201).json({ data: { id: created.id, name: created.name } });
  }),
);

/** Price change. Deliberately the only way a company price moves. */
companiesRouter.patch(
  '/:id',
  requireRole(Role.ADMIN),
  validate(uuidParam, 'params'),
  asyncHandler(async (req, res) => {
    const id = param(req, 'id');
    const before = await prisma.company.findUnique({ where: { id } });
    if (!before) {
      res.status(404).json({ error: { message: 'Şirkət tapılmadı.', code: 'NOT_FOUND' } });
      return;
    }
    const data: Record<string, unknown> = {};
    if (req.body?.filteredPrice !== undefined) data.filteredPrice = String(req.body.filteredPrice);
    if (req.body?.springPrice !== undefined) data.springPrice = String(req.body.springPrice);
    if (req.body?.isActive !== undefined) data.isActive = Boolean(req.body.isActive);
    if (Object.keys(data).length === 0) {
      res.status(400).json({ error: { message: 'Heç nə dəyişmədi.', code: 'BAD_REQUEST' } });
      return;
    }
    const updated = await prisma.company.update({ where: { id }, data });
    await audit({
      actorId: actorOf(req).id,
      actorName: actorOf(req).fullName,
      actorRole: actorOf(req).role,
      action: 'company.updated',
      entityType: 'company',
      entityId: id,
      before: { filteredPrice: before.filteredPrice.toFixed(2), springPrice: before.springPrice.toFixed(2) },
      after: { filteredPrice: updated.filteredPrice.toFixed(2), springPrice: updated.springPrice.toFixed(2) },
      req: req as never,
    });
    res.json({ data: { id: updated.id } });
  }),
);

companiesRouter.post(
  '/:id/offices',
  requireRole(Role.ADMIN),
  validate(uuidParam, 'params'),
  asyncHandler(async (req, res) => {
    const name = String(req.body?.name ?? '').trim();
    if (name.length < 2) {
      res.status(400).json({ error: { message: 'Ofis adı ən azı 2 simvol olmalıdır.', code: 'BAD_REQUEST' } });
      return;
    }
    const companyId = param(req, 'id');
    const count = await prisma.office.count({ where: { companyId } });
    const office = await prisma.office.create({ data: { companyId, name, sortOrder: count } });
    await audit({
      actorId: actorOf(req).id,
      actorName: actorOf(req).fullName,
      actorRole: actorOf(req).role,
      action: 'office.created',
      entityType: 'office',
      entityId: office.id,
      after: { name: office.name },
      req: req as never,
    });
    res.status(201).json({ data: { id: office.id, name: office.name } });
  }),
);