import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getBookingDetail, listCustomerBookings, performAction } from '../services/bookingService.js';
import { id, parse } from '../utils/validate.js';

// Customer side: a user only ever sees bookings where they are the customer.
const router = Router();
router.use(requireAuth);

const asCustomer = (req) => ({ userId: req.user.id, role: 'CUSTOMER' });

router.get('/bookings', (req, res) => {
  res.json({ bookings: listCustomerBookings(req.db, req.user.id) });
});

router.get('/bookings/:bookingId', (req, res) => {
  const bookingId = parse(id, req.params.bookingId);
  res.json({ booking: getBookingDetail(req.db, bookingId, asCustomer(req)) });
});

router.post('/bookings/:bookingId/actions/:action', (req, res) => {
  const booking = performAction(req.db, {
    bookingId: parse(id, req.params.bookingId),
    actor: asCustomer(req),
    action: req.params.action,
    payload: req.body,
  });
  res.json({ booking });
});

export default router;
