import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, shopAccess } from '../middleware/auth.js';
import { STATUS } from '../services/bookingMachine.js';
import {
  editEstimate,
  getBookingDetail,
  listShopBookings,
  performAction,
} from '../services/bookingService.js';
import { id, parse } from '../utils/validate.js';

// Mounted at /api/shops/:shopId/bookings. Every query is scoped by req.shopId.
const router = Router({ mergeParams: true });
router.use(requireAuth, shopAccess());

const asStaff = (req) => ({ userId: req.user.id, role: req.role });

router.get('/', (req, res) => {
  const { status, view } = parse(
    z.object({
      status: z.enum(Object.values(STATUS)).optional(),
      view: z.enum(['TECHNICIAN', 'PARTS', 'QC']).optional(),
    }),
    req.query,
  );
  const bookings = listShopBookings(req.db, {
    shopId: req.shopId,
    role: req.role,
    userId: req.user.id,
    status,
    view,
  });
  res.json({ bookings });
});

router.get('/:bookingId', (req, res) => {
  const booking = getBookingDetail(req.db, parse(id, req.params.bookingId), asStaff(req), req.shopId);
  res.json({ booking });
});

router.post('/:bookingId/actions/:action', (req, res) => {
  const booking = performAction(req.db, {
    bookingId: parse(id, req.params.bookingId),
    shopId: req.shopId,
    actor: asStaff(req),
    action: req.params.action,
    payload: req.body,
  });
  res.json({ booking });
});

router.put('/:bookingId/estimate', (req, res) => {
  const estimate = editEstimate(req.db, {
    bookingId: parse(id, req.params.bookingId),
    shopId: req.shopId,
    actor: asStaff(req),
    body: req.body,
  });
  res.json({ estimate });
});

export default router;
