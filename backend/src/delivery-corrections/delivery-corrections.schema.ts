import { z } from 'zod';

export const createDeliveryCorrectionSchema = z.object({
  deliveryId: z.string().uuid(),
  newBottleCount: z.coerce.number().int().min(1, 'Bidon sayı ən azı 1 olmalıdır.').max(10000),
  reason: z.string().trim().min(3, 'Səbəb ən azı 3 simvol olmalıdır.').max(500),
});

export const reviewDeliveryCorrectionSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
  reason: z.string().trim().max(500).optional(),
});

export const listDeliveryCorrectionsSchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
  deliveryId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
