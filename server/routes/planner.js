const router = require('express').Router();
const auth = require('../middleware/planner-auth');
const UsersDAO = require('../dao/UsersDAO');
const { PlannerService, ASSISTANT_NAME, MEMBER_RUN_LIMIT, CURRENCIES, choice, dateText } = require('../services/PlannerService');
const pick = (body, keys) => Object.fromEntries(keys.filter(key => key in body).map(key => [key, body[key]]));
const service = req => new PlannerService(req.app.get('pool'));
const tripPath = (context, suffix = '') => `/plans/${context.trip.id}${suffix}`;
const invalid = (view, error, data) => ({ view, status: 400, error: error.message, data });

// Runs an action; a validation error (400) goes to onInvalid to re-render the form, anything else propagates.
async function orInvalid(action, onInvalid) {
  try {
    return await action();
  } catch (error) {
    if (error.status !== 400) throw error;
    return onInvalid(error);
  }
}

// All planner mutations (including unknown paths) require the same CSRF defense.
router.use(['/plans', '/join'], auth.csrfProtection);

router.get('/login', (req, res) => {
  if (req.viewer.userId) return res.redirect('/plans');
  auth.render(req, res, 'login');
});
router.post('/login', auth.csrfProtection, async (req, res) => {
  await auth.attempt(req, 'login', 10);
  const { username, password } = req.body;
  const valid = typeof username === 'string' && typeof password === 'string' && username.length <= 120 && password.length <= 1024;
  const user = valid ? await new UsersDAO(req.app.get('pool')).findByUsername(username.trim().toLowerCase()) : null;
  // Always hash, so an unknown username takes as long as a wrong password.
  if (!await auth.verifyPassword(valid ? password : '', user?.password_hash) || !user) {
    return auth.render(req, res, 'login', {}, 'Invalid username or password.', 400);
  }
  await auth.regenerate(req);
  req.session.userId = user.id;
  await auth.saveSession(req);
  res.redirect('/plans');
});
router.post('/logout', auth.csrfProtection, async (req, res) => {
  await new Promise((resolve, reject) => req.session.destroy(error => error ? reject(error) : resolve()));
  res.clearCookie('hotel.sid', { httpOnly: true, sameSite: 'lax', secure: req.app.get('plannerConfig').cookieSecure });
  res.redirect('/login');
});

router.get('/plans', auth.authenticated, async (req, res) => {
  const trips = await service(req).list(req.viewer);
  auth.render(req, res, 'plans', { trips });
});

router.post('/plans', auth.authenticated, auth.account, async (req, res) => {
  const planner = service(req);
  await orInvalid(async () => {
    const trip = await planner.create(req.body, req.viewer);
    res.redirect(`/plans/${trip.id}${trip.generation_requested_at ? '#butler' : ''}`);
    if (trip.generation_requested_at) pingDiscord(req.app.get('plannerConfig'), trip);
  }, async error => auth.render(req, res, 'plans', { trips: await planner.list(req.viewer), values: req.body }, error.message, 400));
});

router.post('/plans/demo', auth.authenticated, auth.account, async (req, res) => {
  const trip = await service(req).demo(req.viewer);
  res.redirect(`/plans/${trip.id}`);
});

// Each person picks the currency prices are shown in (session-scoped); defaults to the trip's.
function displayMoney(req, trip) {
  const rates = req.app.get('rates');
  const currency = CURRENCIES.includes(req.session?.displayCurrency) ? req.session.displayCurrency : trip.currency;
  return { currency, travelers: trip.travelers, date: rates.current?.date || null, convert: (amount, from) => rates.convert(amount, from, currency) };
}

// A route inside one trip: signed in, run in the trip's transaction. Pass ORGANIZER first for organizer-only routes
// (checked once the trip is loaded, since being the organizer means owning this trip).
// The handler returns { view, data, error?, status? }, { redirect } or { json };
// an optional `after` runs once the transaction has committed.
const ORGANIZER = 'organizer-only';
function tripRoute(method, path, ...args) {
  const handler = args.pop();
  const organizerOnly = args[0] === ORGANIZER;
  router[method](path, auth.authenticated, async (req, res) => {
    const planner = service(req);
    const result = await planner.withTrip(req.params.id, req.viewer, async context => {
      req.viewer = { ...req.viewer, isOrganizer: context.isOrganizer, tripId: context.trip.id,
        participantId: context.participant.id, name: context.participant.name };
      if (organizerOnly && !context.isOrganizer) throw auth.httpError(403, 'Only the organizer can do that.');
      context.money = res.locals.money = displayMoney(req, context.trip);
      return handler(req, planner, context);
    });
    if (result.redirect) res.redirect(result.redirect);
    else if (result.json) res.json(result.json);
    else auth.render(req, res, result.view, result.data, result.error || null, result.status || 200);
    result.after?.();
  });
}
const onTrip = {
  get: (path, ...stack) => tripRoute('get', path, ...stack),
  post: (path, ...stack) => tripRoute('post', path, ...stack),
};

// ── Board views ──

// Polled by the board while a research request waits, so the page can reload when the run lands.
onTrip.get('/plans/:id/butler-status', async (req, planner, { trip }) => ({
  json: { waiting: Boolean(trip.generation_requested_at), last_run_at: trip.last_run_at },
}));
onTrip.get('/plans/:id', async (req, planner, context) => ({ view: 'board', data: await planner.board(context, req.query) }));
onTrip.get('/plans/:id/compare', async (req, planner, context) => ({ view: 'compare', data: await planner.compare(context, req.query) }));
onTrip.get('/plans/:id/selected', async (req, planner, context) => ({ view: 'selected', data: await planner.selected(context) }));

// ── Ideas ──

async function ideaForm(planner, context, item, values) {
  return {
    trip: context.trip, item, values,
    destinations: await planner.destinations(context),
    ...(item ? await planner.formLinks(context, item) : { links: [], otherLinks: [] }),
    formAction: tripPath(context, item ? `/ideas/${item.id}/edit` : '/ideas'),
  };
}

async function editableItem(req, planner, context) {
  const item = await planner.item(context, req.params.itemId);
  planner.ensureCanEdit(req.viewer, context, item);
  return item;
}

const ideaDetail = (req, planner, context) => planner.ideaDetail(context, req.viewer, req.params.itemId);

onTrip.get('/plans/:id/ideas/new', async (req, planner, context) => ({
  view: 'idea-form', data: await ideaForm(planner, context, null, { kind: req.query.kind, destination_id: req.query.destination }),
}));

onTrip.post('/plans/:id/ideas', (req, planner, context) => orInvalid(async () => {
  const item = await planner.saveIdeaForm(context, req.body);
  return { redirect: tripPath(context, `/ideas/${item.id}`) };
}, async error => invalid('idea-form', error, await ideaForm(planner, context, null, req.body))));

onTrip.get('/plans/:id/ideas/:itemId', async (req, planner, context) => ({ view: 'idea', data: await ideaDetail(req, planner, context) }));

onTrip.get('/plans/:id/ideas/:itemId/edit', async (req, planner, context) => {
  const item = await editableItem(req, planner, context);
  return { view: 'idea-form', data: await ideaForm(planner, context, item, item) };
});

onTrip.post('/plans/:id/ideas/:itemId/edit', async (req, planner, context) => {
  const item = await editableItem(req, planner, context);
  return orInvalid(async () => {
    await planner.saveIdeaForm(context, req.body, item);
    return { redirect: tripPath(context, `/ideas/${item.id}`) };
  }, async error => invalid('idea-form', error, await ideaForm(planner, context, item, req.body)));
});

onTrip.post('/plans/:id/ideas/:itemId/vote', async (req, planner, context) => {
  const item = await planner.vote(context, req.params.itemId);
  const returnTo = String(req.body.returnTo || '');
  if (returnTo === 'board') return { redirect: tripPath(context, `#idea-${item.id}`) };
  // A destination page lists its options; voting on one returns there.
  if (/^[1-9]\d{0,9}$/.test(returnTo)) return { redirect: tripPath(context, `/ideas/${returnTo}#idea-${item.id}`) };
  return { redirect: tripPath(context, `/ideas/${item.id}`) };
});

onTrip.post('/plans/:id/ideas/:itemId/comments', async (req, planner, context) => {
  const item = await planner.addComment(context, req.params.itemId, req.body.body);
  return { redirect: tripPath(context, `/ideas/${item.id}`) };
});

onTrip.post('/plans/:id/ideas/:itemId/status', async (req, planner, context) => {
  const item = await planner.updateStatus(context, req.viewer, req.params.itemId, req.body.status);
  return { redirect: tripPath(context, req.body.returnTo === 'selected' ? '/selected' : `/ideas/${item.id}`) };
});

onTrip.post('/plans/:id/ideas/:itemId/delete', async (req, planner, context) => {
  await planner.removeIdea(context, req.viewer, req.params.itemId);
  return { redirect: tripPath(context) };
});

// ── Photos (managed on the idea page; links are edited in the idea form) ──

// Form state to re-render the idea page with a photo error pointing at the right field.
function photoError(req, action, error) {
  const field = error.field ? {
    field: error.field, message: error.message,
    prefix: action === 'add' ? 'new-image' : `image-${req.params.imageId}`,
  } : null;
  return {
    imageValues: { url: req.body.url, caption: req.body.caption, source_url: req.body.source_url, id: req.params.imageId || null },
    errorCollection: 'images', referenceAction: action, referenceError: field,
    errorTarget: field ? `${field.prefix}-${field.field}` : 'photos',
    errorTargetLabel: field ? 'Fix photo details' : 'Review photos',
  };
}

// Literal action names keep mutation scope and redirects entirely server-controlled.
for (const action of ['add', 'edit', 'delete', 'cover']) {
  const suffix = action === 'add' ? '' : `/:imageId/${action}`;
  onTrip.post(`/plans/:id/ideas/:itemId/images${suffix}`, async (req, planner, context) => {
    const item = await planner.item(context, req.params.itemId);
    return orInvalid(async () => {
      await planner.mutateReference(context, item, 'images', action, req.params.imageId, req.body);
      return { redirect: tripPath(context, `/ideas/${item.id}#photos`) };
    }, async error => invalid('idea', error, { ...await ideaDetail(req, planner, context), ...photoError(req, action, error) }));
  });
}

// ── Trip settings ──

onTrip.post('/plans/:id/display-currency', async (req, planner, context) => {
  req.session.displayCurrency = choice(req.body.currency, CURRENCIES, 'currency', context.trip.currency);
  return { redirect: tripPath(context) };
});

// The organizer edits the trip details. The description is what the Trip Butler researches, but saving never asks it.
const tripForm = (trip, values) => ({ trip, values: values || { ...trip, travel_start: dateText(trip.travel_start), travel_end: dateText(trip.travel_end) } });
onTrip.get('/plans/:id/edit', ORGANIZER, async (req, planner, context) => ({ view: 'trip-edit', data: tripForm(context.trip) }));
onTrip.post('/plans/:id/edit', ORGANIZER, (req, planner, context) => orInvalid(async () => {
  await planner.updateTrip(context, pick(req.body, ['name', 'description', 'travel_start', 'travel_end', 'travelers']));
  return { redirect: tripPath(context) };
}, async error => invalid('trip-edit', error, tripForm(context.trip, req.body))));

// ── Trip Butler ──

// Any member asks the Trip Butler (optionally with a question). Over the members' daily limit a question is kept for the next run.
onTrip.post('/plans/:id/question', (req, planner, context) => orInvalid(async () => {
  const { trip, queued, capped, saved } = await planner.askButler(context, req.viewer, req.body);
  if (capped) {
    return { view: 'board', status: 429, data: await planner.board(context, {}),
      error: `The ${ASSISTANT_NAME} has done ${MEMBER_RUN_LIMIT} checks for this trip today. ${saved ? 'Your question is saved; ask' : 'Ask'} again tomorrow.` };
  }
  const done = { redirect: tripPath(context, '#butler') };
  // Ping after the commit, so the agent never finds the request missing.
  return queued ? { ...done, after: () => pingDiscord(req.app.get('plannerConfig'), trip) } : done;
}, async error => invalid('board', error, { ...await planner.board(context, {}), questionValue: req.body.question })));

// The organizer withdraws a waiting request (e.g. the assistant never picked it up); asking again re-queues and re-pings.
onTrip.post('/plans/:id/question/cancel', ORGANIZER, async (req, planner, context) => {
  await planner.cancelGeneration(context);
  return { redirect: tripPath(context, '#butler') };
});

// Optional nudge so the agent checks the queue now instead of on its next scheduled run. Carries no brief
// content; the only allowed @mention is the configured bot user. Failures are only logged: the queue still has the request.
async function pingDiscord({ discordWebhook: webhook, discordMention: mention }, trip) {
  if (!webhook) return;
  const who = mention ? `<@${mention}> ` : '';
  const content = `${who}Please run the hotel_tracker_butler skill for trip ${trip.id}. Take the active request from GET /api/v1/generation-queue.`;
  try {
    const response = await fetch(webhook, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(5000),
      body: JSON.stringify({ content, allowed_mentions: { parse: [], users: mention ? [mention] : [] } }),
    });
    if (!response.ok) console.warn('Discord ping failed:', response.status);
  } catch (error) {
    console.warn('Discord ping failed:', error.name);
  }
}

// ── Sharing ──

onTrip.get('/plans/:id/share', ORGANIZER, async (req, planner, context) => ({
  view: 'share', data: { trip: context.trip, invitePath: await planner.invite(context), members: await planner.members(context) },
}));

onTrip.post('/plans/:id/invite/rotate', ORGANIZER, async (req, planner, context) => {
  await planner.invite(context, true);
  return { redirect: tripPath(context, '/share') };
});

onTrip.post('/plans/:id/members/:memberId/remove', ORGANIZER, async (req, planner, context) => {
  await planner.removeMember(context, req.params.memberId);
  return { redirect: tripPath(context, '/share') };
});

const joinPage = (trip, token, values) => ({ trip: { name: trip.name, is_demo: trip.is_demo }, token, values });
const ownsTrip = (viewer, trip) => Boolean(viewer.userId) && trip.owner_id === viewer.userId;

router.get('/join/:token', async (req, res) => {
  const trip = await service(req).inviteTrip(req.params.token);
  if (ownsTrip(req.viewer, trip) || (req.viewer.tripId === trip.id && req.viewer.participantId)) return res.redirect(`/plans/${trip.id}`);
  if (req.membershipRevoked) throw auth.httpError(403, 'Your trip access has been removed. Ask the organizer for help.');
  auth.render(req, res, 'join', joinPage(trip, req.params.token, {}));
});

router.post('/join/:token', async (req, res) => {
  await auth.attempt(req, 'join', 30);
  const planner = service(req);
  try {
    const joined = await planner.join(req.params.token, req.body.name, req.viewer, req.membershipRevoked);
    // The organizer's own trip: never replaced by a guest identity.
    if (!joined.participant) return res.redirect(`/plans/${joined.trip.id}`);
    // An account holder joining a friend's trip stays signed in to their account.
    const userId = req.viewer.userId;
    await auth.regenerate(req);
    if (userId) req.session.userId = userId;
    req.session.participantId = joined.participant.id;
    req.session.tripId = joined.trip.id;
    await auth.saveSession(req);
    res.redirect(`/plans/${joined.trip.id}`);
  } catch (error) {
    if (error.status !== 400) throw error;
    const trip = await planner.inviteTrip(req.params.token);
    auth.render(req, res, 'join', joinPage(trip, req.params.token, req.body), error.message, 400);
  }
});

module.exports = router;