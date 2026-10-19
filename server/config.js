import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const isProduction = process.env.NODE_ENV === 'production';

if (isProduction && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production');
}

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 4000,
  clientUrl: process.env.CLIENT_URL || '',
  dbPath: process.env.DATABASE_PATH || './data/bayflow.db',
  jwtSecret: process.env.JWT_SECRET || 'local-dev-secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  seedOnStart: process.env.SEED_ON_START === 'true',
};
