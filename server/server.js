require('dotenv').config();
const { Pool } = require('pg');
const { createApp } = require('./app');

async function startServer() {
  // DB pool with retry
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let connected = false, retries = 10;
  while (!connected && retries > 0) {
    try {
      await pool.query('SELECT 1');
      connected = true;
      console.log('DB connected');
    } catch (err) {
      console.log(`DB not ready, retries left: ${--retries}`);
      if (retries > 0) await new Promise(r => setTimeout(r, 2000));
      else throw err;
    }
  }

  const app = await createApp({ pool });
  const port = process.env.PORT || 3000;
  return app.listen(port, () => console.log(`Hotel Tracker running on http://localhost:${port}`));
}

module.exports = { startServer, createApp };
if (require.main === module) {
  startServer().catch(err => {
    console.error('Failed to start:', err.message);
    process.exit(1);
  });
}
