import { config } from './config.js';
import { openDatabase } from './db/connection.js';
import { seed } from './db/seed.js';
import { createApp } from './app.js';

const db = openDatabase(config.dbPath);

// Free hosting tiers often wipe the disk on redeploy, so the live demo
// re-seeds itself when it finds an empty database.
const { n: userCount } = db.prepare('SELECT COUNT(*) AS n FROM users').get();
if (config.seedOnStart && userCount === 0) {
  console.log('Empty database, loading demo data...');
  await seed(db);
}

const app = createApp(db);
app.listen(config.port, () => {
  console.log(`BayFlow running on http://localhost:${config.port}`);
});
