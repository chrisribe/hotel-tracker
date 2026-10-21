const { randomBytes, createHash, createHmac, timingSafeEqual, scrypt } = require('node:crypto');
const { promisify } = require('node:util');
const ParticipantsDAO = require('../dao/ParticipantsDAO');
const AttemptsDAO = require('../dao/AttemptsDAO');
const UsersDAO = require('../dao/UsersDAO');

const digest = value => createHash('sha256').update(String(value)).digest();
const tokenHash = value => digest(value).toString('hex');
const randomToken = () => randomBytes(32).toString('hex');
const safeEqual = (left, right) => timingSafeEqual(digest(left), digest(right));

// Passwords: Node's built-in scrypt (OWASP parameters N=2^15, r=8, p=3), stored as scrypt$N$r$p$salt$hash.
const scryptAsync = promisify(scrypt);
const SCRYPT = { N: 32768, r: 8, p: 3 };
const MAXMEM = 64 * 1024 * 1024;
// Checked when the username is unknown, so a miss takes as long as a wrong password.
const UNKNOWN_USER = `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${randomBytes(16).toString('base64')}$${randomBytes(32).toString('base64')}`;

async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 32, { ...SCRYPT, maxmem: MAXMEM });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

async function verifyPassword(password, stored) {
  const [scheme, N, r, p, salt, hash] = (stored || UNKNOWN_USER).split('$');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scryptAsync(password, Buffer.from(salt, 'base64'), expected.length, { N: +N, r: +r, p: +p, maxmem: MAXMEM });
  return timingSafeEqual(actual, expected) && Boolean(stored);
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function render(req, res, view, data = {}, error = null, status = 200) {
  const titles = { login: 'Sign in', plans: 'Trip plans', board: 'Trip research',
    compare: 'Compare options', selected: 'Selected plan',
    'idea-form': 'Research idea', idea: 'Research idea', share: 'Share trip', 'trip-edit': 'Edit trip', join: 'Join trip', error: 'Request unavailable' };
  return res.status(status).render('planner-shell', {
    view,
    title: `${titles[view]} — PlanTrip`,
    data: { trip: null, trips: [], ...data },
    viewer: req.viewer || { userId: null, isOrganizer: false, name: '', participantId: null, tripId: null },
    csrfToken: req.session?.csrfToken || '',
    error,
  });
}

function sameOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('Sec-Fetch-Site') === 'cross-site') return next(httpError(403, 'Cross-site requests are not allowed.'));
  const source = req.get('Origin') || req.get('Referer');
  if (source) {
    try {
      if (new URL(source).origin !== `${req.protocol}://${req.get('host')}`) {
        return next(httpError(403, 'Cross-site requests are not allowed.'));
      }
    } catch { return next(httpError(403, 'Invalid request origin.')); }
  }
  next();
}

function csrfProtection(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (typeof req.body?._csrf !== 'string' || !req.session?.csrfToken ||
      !safeEqual(req.body._csrf, req.session.csrfToken)) {
    return next(httpError(403, 'This form expired. Reload the page and try again.'));
  }
  next();
}

// A session can hold an account (userId) and one trip joined by invite (participantId + tripId).
// isOrganizer is never set here: trip routes set it when the account owns the trip being opened.
async function identify(req, res, next) {
  req.session.csrfToken ||= randomToken();
  req.viewer = { userId: null, isOrganizer: false, name: '', participantId: null, tripId: null };
  if (req.session.userId) {
    const user = await new UsersDAO(req.app.get('pool')).find(req.session.userId);
    if (user) req.viewer = { ...req.viewer, userId: user.id, name: user.username };
    else delete req.session.userId;
  }
  if (req.session.participantId) {
    const participant = await new ParticipantsDAO(req.app.get('pool'))
      .findActiveGuest(req.session.tripId, req.session.participantId);
    if (participant) {
      req.viewer = { ...req.viewer, name: req.viewer.name || participant.name, participantId: participant.id, tripId: participant.trip_id };
    } else if (req.viewer.userId) {
      // Removed from someone else's trip: the account keeps working.
      delete req.session.participantId;
      delete req.session.tripId;
    } else req.membershipRevoked = true;
  }
  next();
}

function authenticated(req, res, next) {
  if (req.membershipRevoked) return next(httpError(403, 'Your trip access has been removed.'));
  if (!req.viewer.userId && !req.viewer.participantId) return res.redirect('/login');
  next();
}

function account(req, res, next) {
  if (!req.viewer.userId) return next(httpError(403, 'Sign in to an organizer account to do that.'));
  next();
}

const attemptKey = (req, scope) => createHmac('sha256', req.app.get('sessionSecret')).update(`${scope}:${req.ip}`).digest('hex');

function attemptLimit() {
  const error = httpError(429, 'Too many attempts. Try again in 15 minutes.');
  error.retryAfter = 900;
  return error;
}

async function attempt(req, scope, limit) {
  if (await new AttemptsDAO(req.app.get('pool')).increment(attemptKey(req, scope)) > limit) throw attemptLimit();
}

// Check without counting, so only failures consume the budget.
async function ensureNotBlocked(req, scope, limit) {
  if (await new AttemptsDAO(req.app.get('pool')).count(attemptKey(req, scope)) >= limit) throw attemptLimit();
}

function regenerate(req) {
  return new Promise((resolve, reject) => req.session.regenerate(error => {
    if (error) return reject(error);
    req.session.csrfToken = randomToken();
    resolve();
  }));
}

function saveSession(req) {
  return new Promise((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
}

module.exports = { render, httpError, sameOrigin, csrfProtection, identify, authenticated, account,
  hashPassword, verifyPassword, attempt, ensureNotBlocked, regenerate, saveSession, randomToken, tokenHash, safeEqual };