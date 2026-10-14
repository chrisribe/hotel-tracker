const { randomBytes, createHash, createHmac, timingSafeEqual } = require('node:crypto');
const ParticipantsDAO = require('../dao/ParticipantsDAO');
const AttemptsDAO = require('../dao/AttemptsDAO');

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
    const participant = await new ParticipantsDAO(req.app.get('pool'))
      .findActiveGuest(req.session.tripId, req.session.participantId);
    if (participant) {
      req.viewer = { isOrganizer: false, name: participant.name, participantId: participant.id, tripId: participant.trip_id };
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

async function attempt(req, scope, limit) {
  const key = createHmac('sha256', req.app.get('sessionSecret')).update(`${scope}:${req.ip}`).digest('hex');
  if (await new AttemptsDAO(req.app.get('pool')).increment(key) > limit) throw httpError(429, 'Too many attempts. Try again in 15 minutes.');
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

module.exports = { render, httpError, sameOrigin, csrfProtection, identify, authenticated, organizer,
  credentialsMatch, attempt, regenerate, saveSession, randomToken, tokenHash };