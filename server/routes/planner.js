const router = require('express').Router();
const auth = require('../middleware/planner-auth');
const { PlannerService, CURRENCIES, choice } = require('../services/PlannerService');
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
  if (req.viewer.isOrganizer) return res.redirect('/plans');
  auth.render(req, res, 'login');
});
router.post('/login', auth.csrfProtection, async (req, res) => {
  await auth.attempt(req, 'login', 10);
  const { username, password } = req.body;
  if (typeof username !== 'string' || typeof password !== 'string' || username.length > 120 || password.length > 1024 ||
      !auth.credentialsMatch(username, password, req.app.get('plannerConfig'))) {
    return auth.render(req, res, 'login', {}, 'Invalid username or password.', 400);
  }
  await auth.regenerate(req);
  req.session.isOrganizer = true;
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

router.post('/plans', auth.authenticated, auth.organizer, async (req, res) => {
  const planner = service(req);
  await orInvalid(async () => {
    const trip = await planner.create(req.body, req.viewer);
    res.redirect(`/plans/${trip.id}`);
  }, async error => auth.render(req, res, 'plans', { trips: await planner.list(req.viewer), values: req.body }, error.message, 400));
});

router.post('/plans/demo', auth.authenticated, auth.organizer, async (req, res) => {
  const trip = await service(req).demo(req.viewer);
  res.redirect(`/plans/${trip.id}`);
});

// Each person picks the currency prices are shown in (session-scoped); defaults to the trip's.
function displayMoney(req, trip) {
  const rates = req.app.get('rates');
  const currency = CURRENCIES.includes(req.session?.displayCurrency) ? req.session.displayCurrency : trip.currency;
  return { currency, travelers: trip.travelers, date: rates.current?.date || null, convert: (amount, from) => rates.convert(amount, from, currency) };
}

// A route inside one trip: signed in (plus any extra guards), run in the trip's transaction.
// The handler returns { view, data, error?, status? }, { redirect } or { json };
// an optional `after` runs once the transaction has committed.
function tripRoute(method, path, ...stack) {
  const handler = stack.pop();
  router[method](path, auth.authenticated, ...stack, async (req, res) => {
    const planner = service(req);
    const result = await planner.withTrip(req.params.id, req.viewer, async context => {
      req.viewer = { ...req.viewer, tripId: context.trip.id, participantId: context.participant.id };
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
onTrip.get('/plans/:id/brief-status', async (req, planner, { trip }) => ({
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

// Group size used to show a rough per-person share of each total quote.
onTrip.post('/plans/:id/travelers', auth.organizer, async (req, planner, context) => {
  await planner.updateTrip(context, { travelers: req.body.travelers });
  return { redirect: tripPath(context, '/share') };
});

// ── Trip Butler ──

// Saves the brief and asks the Trip Butler to start (generate) or update (refresh) research; cancel withdraws the request.
onTrip.post('/plans/:id/brief', auth.organizer, (req, planner, context) => orInvalid(async () => {
  const action = choice(req.body.action, ['generate', 'refresh', 'cancel'], 'brief action', 'generate');
  const done = { redirect: tripPath(context, '#brief') };
  if (action === 'cancel') {
    await planner.cancelGeneration(context);
    return done;
  }
  await planner.updateTrip(context, { brief_text: req.body.brief_text });
  const { trip, queued } = await planner.requestGeneration(context, action);
  // Ping after the commit, so the agent never finds the request missing.
  return queued ? { ...done, after: () => pingDiscord(req.app.get('plannerConfig'), trip) } : done;
}, async error => invalid('board', error, { ...await planner.board(context, {}), briefValue: req.body.brief_text })));

// Optional nudge so the agent checks the queue now instead of on its next scheduled run. Carries no brief
// content; the only allowed @mention is the configured bot user. Failures are only logged: the queue still has the request.
async function pingDiscord({ discordWebhook: webhook, discordMention: mention }, trip) {
  if (!webhook) return;
  const name = trip.name.length > 80 ? `${trip.name.slice(0, 79)}…` : trip.name;
  const verb = trip.generation_mode === 'refresh' ? 'update the research' : 'start research';
  const who = mention ? `<@${mention}> ` : '';
  const content = `${who}Please run the hotel_tracker_butler skill: trip ${trip.id} “${name}” asks you to ${verb}. Take it from GET /api/v1/generation-queue.`;
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

onTrip.get('/plans/:id/share', auth.organizer, async (req, planner, context) => ({
  view: 'share', data: { trip: context.trip, invitePath: await planner.invite(context), members: await planner.members(context) },
}));

onTrip.post('/plans/:id/invite/rotate', auth.organizer, async (req, planner, context) => {
  await planner.invite(context, true);
  return { redirect: tripPath(context, '/share') };
});

onTrip.post('/plans/:id/members/:memberId/remove', auth.organizer, async (req, planner, context) => {
  await planner.removeMember(context, req.params.memberId);
  return { redirect: tripPath(context, '/share') };
});

const joinPage = (trip, token, values) => ({ trip: { name: trip.name, is_demo: trip.is_demo }, token, values });

router.get('/join/:token', async (req, res) => {
  const trip = await service(req).inviteTrip(req.params.token);
  if (req.viewer.isOrganizer || (req.viewer.tripId === trip.id && req.viewer.participantId)) return res.redirect(`/plans/${trip.id}`);
  if (req.membershipRevoked) throw auth.httpError(403, 'Your trip access has been removed. Ask the organizer for help.');
  auth.render(req, res, 'join', joinPage(trip, req.params.token, {}));
});

router.post('/join/:token', async (req, res) => {
  await auth.attempt(req, 'join', 30);
  const planner = service(req);
  try {
    // Organizer identity is never replaced by a guest identity.
    if (req.viewer.isOrganizer) {
      const trip = await planner.inviteTrip(req.params.token);
      return res.redirect(`/plans/${trip.id}`);
    }
    const joined = await planner.join(req.params.token, req.body.name, req.viewer, req.membershipRevoked);
    await auth.regenerate(req);
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