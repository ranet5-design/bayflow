import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, signToken } from '../middleware/auth.js';
import { conflict, unauthorized } from '../utils/errors.js';
import { email, parse, password } from '../utils/validate.js';
import {
  checkPassword,
  findByEmail,
  getMemberships,
  hashPassword,
  publicUser,
} from '../services/userService.js';

const router = Router();

const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email,
  phone: z.string().trim().max(30).optional(),
  password,
});

const loginSchema = z.object({ email, password: z.string().min(1) });

function sessionPayload(db, user) {
  return {
    token: signToken(user),
    user: publicUser(user),
    memberships: getMemberships(db, user.id),
  };
}

// Only shop owners sign up here. Customers get an account through booking,
// staff accounts are created by the owner.
router.post('/register-owner', async (req, res) => {
  const body = parse(registerSchema, req.body);
  if (findByEmail(req.db, body.email)) throw conflict('An account with this email already exists');

  const hash = await hashPassword(body.password);
  const result = req.db
    .prepare('INSERT INTO users (name, email, phone, password_hash, is_owner) VALUES (?, ?, ?, ?, 1)')
    .run(body.name, body.email, body.phone ?? null, hash);

  const user = req.db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(sessionPayload(req.db, user));
});

router.post('/login', async (req, res) => {
  const body = parse(loginSchema, req.body);
  const user = findByEmail(req.db, body.email);
  if (!user || !(await checkPassword(body.password, user.password_hash))) {
    throw unauthorized('Wrong email or password');
  }
  res.json(sessionPayload(req.db, user));
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user), memberships: getMemberships(req.db, req.user.id) });
});

export default router;
