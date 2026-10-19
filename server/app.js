import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { errorHandler, notFound } from './utils/errors.js';
import authRoutes from './routes/auth.js';
import publicRoutes from './routes/public.js';
import customerRoutes from './routes/customer.js';
import shopRoutes from './routes/shops.js';
import shopBookingRoutes from './routes/shopBookings.js';
import inventoryRoutes from './routes/inventory.js';
import notificationRoutes from './routes/notifications.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

export function createApp(db) {
  const app = express();

  app.disable('x-powered-by');
  if (config.clientUrl) app.use(cors({ origin: config.clientUrl }));
  app.use(express.json({ limit: '100kb' }));
  app.use((req, res, next) => {
    req.db = db;
    next();
  });

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRoutes);
  app.use('/api/public', publicRoutes);
  app.use('/api/me', customerRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/shops/:shopId/bookings', shopBookingRoutes);
  app.use('/api/shops/:shopId', inventoryRoutes);
  app.use('/api/shops', shopRoutes);
  app.use('/api', (req, res, next) => next(notFound('API route not found')));

  // Frontend is a static single page app served from the same origin.
  app.use(express.static(publicDir));
  app.get(/^\/(?!api).*/, (req, res) => res.sendFile(path.join(publicDir, 'index.html')));

  app.use(errorHandler);
  return app;
}
