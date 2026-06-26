require('dotenv').config();
const express = require('express');
const path = require('path');
const basicAuth = require('express-basic-auth');
const { Pool } = require('pg');

async function startServer() {
  const app = express();

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

  // Middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use('/static', express.static(path.join(__dirname, 'static')));

  // View engine
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.set('pool', pool);

  // Security headers
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    if (process.env.NODE_ENV === 'production') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });

  // Basic auth (single-user personal app)
  if (process.env.ADMIN_USER && process.env.ADMIN_PASS) {
    app.use(basicAuth({
      users: { [process.env.ADMIN_USER]: process.env.ADMIN_PASS },
      challenge: true,
      realm: 'HotelTracker',
    }));
  }

  // Response helper (HTMX-aware)
  app.use(require('./middleware/responseHandler'));

  // Routes
  app.get('/', (req, res) => res.redirect('/trips'));
  app.use('/trips', require('./routes/trips'));
  app.use('/hotels', require('./routes/hotels'));

  // Error handler
  app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something went wrong');
  });

  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Hotel Tracker running on http://localhost:${port}`));
}

startServer().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
