const { randomBytes, createHash, createHmac, timingSafeEqual } = require('node:crypto');

const digest = value => createHash('sha256').update(String(value)).digest();
const tokenHash = value => digest(value).toString('hex');
const randomToken = () => randomBytes(32).toString('hex');
const safeEqual = (left, right) => timingSafeEqual(digest(left), digest(right));

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function render(req, res, view, data = {}, error = null, status = 200) {
  const titles = { login: 'Organizer login', plans: 'Trip plans', board: 'Trip research',
    compare: 'Compare options', selected: 'Selected plan',
    'idea-form': 'Research idea', idea: 'Research idea', share: 'Share trip', join: 'Join trip', error: 'Request unavailable' };
  return res.status(status).render('planner-shell', {
    view,
    title: `${titles[view]} — Hotel Tracker`,
    data: { trip: null, trips: [], ...data },
    viewer: req.viewer || { isOrganizer: false, name: '', participantId: null, tripId: null },
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

async function identify(req, res, next) {
  req.session.csrfToken ||= randomToken();
  req.viewer = { isOrganizer: false, name: '', participantId: null, tripId: null };
  if (req.session.isOrganizer === true) {
    req.viewer = { ...req.viewer, isOrganizer: true, name: req.app.get('plannerConfig').adminUser };
  } else if (req.session.participantId) {
    const { rows } = await req.app.get('pool').query(
      'SELECT * FROM participants WHERE id=$1 AND trip_id=$2 AND active=TRUE AND is_organizer=FALSE',
      [req.session.participantId, req.session.tripId]);
    if (rows[0]) {
      req.viewer = { isOrganizer: false, name: rows[0].name, participantId: rows[0].id, tripId: rows[0].trip_id };
    } else req.membershipRevoked = true;
  }
  next();
}

function authenticated(req, res, next) {
  if (req.membershipRevoked) return next(httpError(403, 'Your trip access has been removed.'));
  if (!req.viewer.isOrganizer && !req.viewer.participantId) return res.redirect('/login');
  next();
}

function organizer(req, res, next) {
  if (!req.viewer.isOrganizer) return next(httpError(403, 'Only the organizer can do that.'));
  next();
}

function credentialsMatch(user, password, config) {
  // Evaluate both comparisons, including for an unknown username.
  const userMatches = safeEqual(user, config.adminUser || randomToken());
  const passwordMatches = safeEqual(password, config.adminPass || randomToken());
  return Boolean(config.adminUser && config.adminPass && userMatches && passwordMatches);
}

async function attempt(req, scope, limit, consume = true) {
  const pool = req.app.get('pool');
  const key = createHmac('sha256', req.app.get('sessionSecret')).update(`${scope}:${req.ip}`).digest('hex');
  if (!consume) {
    const { rows } = await pool.query('SELECT attempts FROM planner_attempts WHERE key=$1 AND expires_at>NOW()', [key]);
    if (rows[0]?.attempts >= limit) throw httpError(429, 'Too many attempts. Try again in 15 minutes.');
    return;
  }
  await pool.query('DELETE FROM planner_attempts WHERE expires_at <= NOW()');
  const { rows } = await pool.query(`
    INSERT INTO planner_attempts(key,attempts,expires_at) VALUES($1,1,NOW()+INTERVAL '15 minutes')
    ON CONFLICT(key) DO UPDATE SET attempts=planner_attempts.attempts+1 RETURNING attempts`, [key]);
  if (rows[0].attempts > limit) throw httpError(429, 'Too many attempts. Try again in 15 minutes.');
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

async function legacyAuth(req, res, next) {
  if (req.viewer.isOrganizer) return next();
  if (req.session.participantId) throw httpError(403, 'Legacy hotels and trips are organizer-only.');
  const header = req.get('authorization');
  if (header?.startsWith('Basic ')) {
    // Basic credentials accompany every legacy request; only failures consume attempts.
    await attempt(req, 'legacy-login', 30, false);
    const credentials = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const separator = credentials.indexOf(':');
    if (separator >= 0 && credentialsMatch(credentials.slice(0, separator), credentials.slice(separator + 1), req.app.get('plannerConfig'))) {
      return next();
    }
    await attempt(req, 'legacy-login', 30);
    res.set('WWW-Authenticate', 'Basic realm="HotelTracker"');
    throw httpError(401, 'Organizer credentials are required.');
  }
  return res.redirect('/login');
}

module.exports = { render, httpError, sameOrigin, csrfProtection, identify, authenticated, organizer,
  credentialsMatch, attempt, regenerate, saveSession, legacyAuth, randomToken, tokenHash };