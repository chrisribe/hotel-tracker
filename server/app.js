require('express-async-errors');
const express = require('express');
const path = require('node:path');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const { migrate } = require('./scripts/init-db');
const auth = require('./middleware/planner-auth');

async function createApp({ pool, config = {} }) {
  await migrate(pool);
  const settings = {
    adminUser: process.env.ADMIN_USER,
    adminPass: process.env.ADMIN_PASS,
    sessionSecret: process.env.SESSION_SECRET,
    cookieSecure: process.env.COOKIE_SECURE === 'true',
    trustProxy: process.env.TRUST_PROXY === '1',
    ...config,
  };
  let secret = settings.sessionSecret;
  if (!secret) {
    await pool.query("INSERT INTO planner_settings(key,value) VALUES('session_secret',$1) ON CONFLICT(key) DO NOTHING", [auth.randomToken()]);
    secret = (await pool.query("SELECT value FROM planner_settings WHERE key='session_secret'")).rows[0].value;
  }
  const app = express();
  app.disable('x-powered-by');
  if (settings.trustProxy) app.set('trust proxy', 1);
  app.set('pool', pool);
  app.set('plannerConfig', settings);
  app.set('sessionSecret', secret);
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'DENY');
    res.set('Referrer-Policy', 'same-origin');
    if (process.env.NODE_ENV === 'production') {
      res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });
  app.use('/static', express.static(path.join(__dirname, 'static')));
  app.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  const sessionStore = new PgSession({ pool, tableName: 'planner_sessions', createTableIfMissing: false });
  app.set('sessionStore', sessionStore);
  app.use(session({
    name: 'hotel.sid', secret, store: sessionStore, resave: false, saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: settings.cookieSecure, maxAge: 7 * 24 * 60 * 60 * 1000 },
  }));
  app.use(express.json({ limit: '32kb', strict: true }));
  app.use(express.urlencoded({ extended: false, limit: '32kb', parameterLimit: 40 }));
  app.use(auth.sameOrigin);
  app.use(auth.identify);
  app.get('/', (req, res) => res.redirect('/plans'));
  app.use(require('./routes/planner'));
  app.use(require('./middleware/responseHandler'));
  app.use('/trips', auth.legacyAuth, require('./routes/trips'));
  app.use('/hotels', auth.legacyAuth, require('./routes/hotels'));
  app.use((req, res, next) => next(auth.httpError(404, 'Page not found.')));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = [400, 401, 403, 404, 413, 429].includes(error.status) ? error.status : 500;
    // Never log request paths (invite secrets), credentials, bodies, or session secrets.
    if (status === 500) console.error('Request failed:', error.code || error.name);
    const message = status === 500 ? 'Something went wrong. Please try again.' :
      status === 413 ? 'This submission is too large.' :
      error.type === 'entity.parse.failed' ? 'Invalid request body.' : error.message;
    if (status === 429) res.set('Retry-After', '900');
    auth.render(req, res, 'error', { message, backUrl: '/plans' }, message, status);
  });
  return app;
}

module.exports = { createApp };