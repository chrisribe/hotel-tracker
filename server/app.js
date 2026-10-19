require('express-async-errors');
const express = require('express');
const path = require('node:path');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const { migrate } = require('./scripts/init-db');
const auth = require('./middleware/planner-auth');
const { ExchangeRates } = require('./services/ExchangeRates');
const { DETAIL_LABELS, ASSISTANT_NAME } = require('./services/PlannerService');

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
// Only a Discord webhook is ever posted to, so the setting cannot aim requests elsewhere.
const DISCORD_WEBHOOK = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/;
// A numeric user ID, so nothing else can be injected into the ping.
const DISCORD_USER_ID = /^\d{15,25}$/;
const SHOWN_STATUSES = [400, 401, 403, 404, 413, 429];

// Clears an optional setting that is set but invalid, so the feature stays off instead of misbehaving.
function dropInvalid(settings, key, isValid, warning) {
  if (settings[key] && !isValid(settings[key])) {
    console.warn(warning);
    settings[key] = '';
  }
}

function readSettings(overrides) {
  const env = process.env;
  const settings = {
    adminUser: env.ADMIN_USER,
    adminPass: env.ADMIN_PASS,
    sessionSecret: env.SESSION_SECRET,
    cookieSecure: env.COOKIE_SECURE === 'true',
    trustProxy: env.TRUST_PROXY === '1',
    agentToken: env.HOTEL_AGENT_TOKEN || '',
    discordWebhook: env.DISCORD_WEBHOOK_URL || '',
    discordMention: env.DISCORD_MENTION_USER_ID || '',
    ...overrides,
  };
  if (env.HOTEL_API_TOKEN) console.warn('HOTEL_API_TOKEN is no longer used; the API only accepts HOTEL_AGENT_TOKEN.');
  dropInvalid(settings, 'agentToken', v => v.length >= 32,
    'HOTEL_AGENT_TOKEN must be at least 32 characters; API disabled.');
  dropInvalid(settings, 'discordWebhook', (v) => DISCORD_WEBHOOK.test(v),
    'DISCORD_WEBHOOK_URL is not a Discord webhook URL; Discord pings disabled.');
  dropInvalid(settings, 'discordMention', (v) => DISCORD_USER_ID.test(v),
    'DISCORD_MENTION_USER_ID must be a numeric Discord user ID; ping sent without a mention.');
  return settings;
}

// Uses SESSION_SECRET when set; otherwise generates one once and keeps it in the database.
async function loadSessionSecret(pool, configured) {
  if (configured) return configured;
  await pool.query("INSERT INTO planner_settings(key,value) VALUES('session_secret',$1) ON CONFLICT(key) DO NOTHING", [auth.randomToken()]);
  return (await pool.query("SELECT value FROM planner_settings WHERE key='session_secret'")).rows[0].value;
}

function securityHeaders(req, res, next) {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'same-origin');
  if (process.env.NODE_ENV === 'production') {
    res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}

function noStore(req, res, next) {
  res.set('Cache-Control', 'no-store');
  next();
}

function errorMessage(error, status) {
  if (status === 500) return 'Something went wrong. Please try again.';
  if (status === 413) return 'This submission is too large.';
  if (error.type === 'entity.parse.failed') return 'Invalid request body.';
  return error.message;
}

function handleError(error, req, res, next) {
  if (res.headersSent) return next(error);
  const status = SHOWN_STATUSES.includes(error.status) ? error.status : 500;
  // Never log request paths (invite secrets), credentials, bodies, or session secrets.
  if (status === 500) console.error('Request failed:', error.code || error.name);
  if (error.retryAfter) res.set('Retry-After', String(error.retryAfter));
  const message = errorMessage(error, status);
  auth.render(req, res, 'error', { message, backUrl: '/plans' }, message, status);
}

async function createApp({ pool, config = {} }) {
  await migrate(pool);
  const settings = readSettings(config);
  const secret = await loadSessionSecret(pool, settings.sessionSecret);
  const rates = new ExchangeRates(pool);
  await rates.load();
  const sessionStore = new PgSession({ pool, tableName: 'planner_sessions', createTableIfMissing: false });

  const app = express();
  app.disable('x-powered-by');
  if (settings.trustProxy) app.set('trust proxy', 1);
  app.set('pool', pool);
  app.set('rates', rates);
  app.set('plannerConfig', settings);
  app.set('sessionSecret', secret);
  app.set('sessionStore', sessionStore);
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.locals.DETAIL_LABELS = DETAIL_LABELS;
  app.locals.ASSISTANT_NAME = ASSISTANT_NAME;

  app.use(securityHeaders);
  app.use('/static', express.static(path.join(__dirname, 'static')));
  app.use(noStore);

  // Bearer-token API: no cookies, sessions or CSRF.
  app.use('/api/v1', require('./routes/api'));

  // Browser planner: session cookie, same-origin checks.
  app.use(session({
    name: 'hotel.sid', secret, store: sessionStore, resave: false, saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: settings.cookieSecure, maxAge: WEEK_MS },
  }));
  app.use(express.json({ limit: '32kb', strict: true }));
  // Idea forms carry up to 20 link rows (3 fields each) and 12 detail rows (2 fields each).
  app.use(express.urlencoded({ extended: false, limit: '32kb', parameterLimit: 120 }));
  app.use(auth.sameOrigin);
  app.use(auth.identify);
  app.get('/', (req, res) => res.redirect('/plans'));
  app.use(require('./routes/planner'));

  app.use((req, res, next) => next(auth.httpError(404, 'Page not found.')));
  app.use(handleError);
  return app;
}

module.exports = { createApp };