const router = require('express').Router();
const auth = require('../middleware/planner-auth');
const { PlannerService, CURRENCIES, choice } = require('../services/PlannerService');
const service = req => new PlannerService(req.app.get('pool'));

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
  try {
    const trip = await service(req).create(req.body, req.viewer);
    res.redirect(`/plans/${trip.id}`);
  } catch (error) {
    if (error.status !== 400) throw error;
    auth.render(req, res, 'plans', { trips: await service(req).list(req.viewer), values: req.body }, error.message, 400);
  }
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

function scoped(handler) {
  return async (req, res) => {
    const planner = service(req);
    const result = await planner.withTrip(req.params.id, req.viewer, async context => {
      req.viewer = { ...req.viewer, tripId: context.trip.id, participantId: context.participant.id };
      context.money = res.locals.money = displayMoney(req, context.trip);
      return handler(req, planner, context);
    });
    if (result.redirect) return res.redirect(result.redirect);
    auth.render(req, res, result.view, result.data, result.error || null, result.status || 200);
  };
}

router.get('/plans/:id', auth.authenticated, scoped(async (req, planner, context) => ({
  view: 'board', data: await planner.board(context, req.query),
})));

router.get('/plans/:id/compare', auth.authenticated, scoped(async (req, planner, context) => ({
  view: 'compare', data: await planner.compare(context, req.query),
})));

router.get('/plans/:id/selected', auth.authenticated, scoped(async (req, planner, context) => ({
  view: 'selected', data: await planner.selected(context),
})));

router.get('/plans/:id/ideas/new', auth.authenticated, scoped(async (req, planner, context) => ({
  view: 'idea-form', data: { trip: context.trip, item: null, destinations: await planner.destinations(context),
    formAction: `/plans/${context.trip.id}/ideas`, values: { kind: req.query.kind, destination_id: req.query.destination } },
})));

router.post('/plans/:id/ideas', auth.authenticated, scoped(async (req, planner, context) => {
  try {
    const item = await planner.writeIdea(context, req.body);
    return { redirect: `/plans/${context.trip.id}/ideas/${item.id}` };
  } catch (error) {
    if (error.status !== 400) throw error;
    return { view: 'idea-form', status: 400, error: error.message, data: {
      trip: context.trip, item: null, destinations: await planner.destinations(context),
      formAction: `/plans/${context.trip.id}/ideas`, values: req.body,
    } };
  }
}));

async function ideaDetail(req, planner, context) {
  return planner.ideaDetail(context, req.viewer, req.params.itemId);
}

router.get('/plans/:id/ideas/:itemId', auth.authenticated, scoped(async (req, planner, context) => ({
  view: 'idea', data: await ideaDetail(req, planner, context),
})));

// Literal collection/action names keep mutation scope and redirects entirely server-controlled.
for (const collection of ['sources', 'images']) {
  const image = collection === 'images';
  const param = image ? 'imageId' : 'sourceId';
  for (const action of ['add', 'edit', 'delete', ...(image ? ['cover'] : [])]) {
    const suffix = action === 'add' ? '' : `/:${param}/${action}`;
    router.post(`/plans/:id/ideas/:itemId/${collection}${suffix}`, auth.authenticated, scoped(async (req, planner, context) => {
      const item = await planner.item(context, req.params.itemId);
      try {
        await planner.mutateReference(context, item, collection, action, req.params[param], req.body);
        return { redirect: `/plans/${context.trip.id}/ideas/${item.id}#${image ? 'photos' : 'sources'}` };
      } catch (error) {
        if (error.status !== 400) throw error;
        const values = image ? { url: req.body.url, caption: req.body.caption, source_url: req.body.source_url } :
          { label: req.body.label, url: req.body.url, takeaway: req.body.takeaway };
        const referenceError = error.field ? {
          field: error.field, message: error.message,
          prefix: action === 'add' ? (image ? 'new-image' : 'new-source') : `${image ? 'image' : 'source'}-${req.params[param]}`,
        } : null;
        return { view: 'idea', status: 400, error: error.message, data: {
          ...await ideaDetail(req, planner, context),
          [image ? 'imageValues' : 'sourceValues']: { ...values, id: req.params[param] || null },
          errorCollection: collection, referenceAction: action,
          referenceError,
          errorTarget: referenceError ? `${referenceError.prefix}-${referenceError.field}` : (image ? 'photos' : 'sources'),
          errorTargetLabel: referenceError ? `Fix ${image ? 'photo' : 'source'} details` : `Review ${image ? 'photos' : 'sources'}`,
        } };
      }
    }));
  }
}

router.get('/plans/:id/ideas/:itemId/edit', auth.authenticated, scoped(async (req, planner, context) => {
  const item = await planner.item(context, req.params.itemId);
  planner.ensureCanEdit(req.viewer, context, item);
  return { view: 'idea-form', data: { trip: context.trip, item, destinations: await planner.destinations(context),
    formAction: `/plans/${context.trip.id}/ideas/${item.id}/edit`, values: item } };
}));

router.post('/plans/:id/ideas/:itemId/edit', auth.authenticated, scoped(async (req, planner, context) => {
  const item = await planner.item(context, req.params.itemId);
  planner.ensureCanEdit(req.viewer, context, item);
  try {
    await planner.writeIdea(context, req.body, item);
    return { redirect: `/plans/${context.trip.id}/ideas/${item.id}` };
  } catch (error) {
    if (error.status !== 400) throw error;
    return { view: 'idea-form', status: 400, error: error.message, data: {
      trip: context.trip, item, destinations: await planner.destinations(context),
      formAction: `/plans/${context.trip.id}/ideas/${item.id}/edit`, values: req.body,
    } };
  }
}));

router.post('/plans/:id/ideas/:itemId/vote', auth.authenticated, scoped(async (req, planner, context) => {
  const item = await planner.vote(context, req.params.itemId);
  const base = `/plans/${context.trip.id}`;
  const returnTo = String(req.body.returnTo || '');
  if (returnTo === 'board') return { redirect: `${base}#idea-${item.id}` };
  // A destination page lists its options; voting on one returns there.
  if (/^[1-9]\d{0,9}$/.test(returnTo)) return { redirect: `${base}/ideas/${returnTo}#idea-${item.id}` };
  return { redirect: `${base}/ideas/${item.id}` };
}));

router.post('/plans/:id/ideas/:itemId/comments', auth.authenticated, scoped(async (req, planner, context) => {
  const item = await planner.addComment(context, req.params.itemId, req.body.body);
  return { redirect: `/plans/${context.trip.id}/ideas/${item.id}` };
}));

router.post('/plans/:id/ideas/:itemId/status', auth.authenticated, scoped(async (req, planner, context) => {
  const item = await planner.updateStatus(context, req.viewer, req.params.itemId, req.body.status);
  return { redirect: req.body.returnTo === 'selected' ? `/plans/${context.trip.id}/selected` : `/plans/${context.trip.id}/ideas/${item.id}` };
}));

router.post('/plans/:id/ideas/:itemId/delete', auth.authenticated, scoped(async (req, planner, context) => {
  await planner.removeIdea(context, req.viewer, req.params.itemId);
  return { redirect: `/plans/${context.trip.id}` };
}));

router.get('/plans/:id/share', auth.authenticated, auth.organizer, scoped(async (req, planner, context) => ({
  view: 'share', data: { trip: context.trip, invitePath: await planner.invite(context), members: await planner.members(context) },
})));

router.post('/plans/:id/display-currency', auth.authenticated, scoped(async (req, planner, context) => {
  req.session.displayCurrency = choice(req.body.currency, CURRENCIES, 'currency', context.trip.currency);
  return { redirect: `/plans/${context.trip.id}` };
}));

// Group size used to show a rough per-person share of each total quote.
router.post('/plans/:id/travelers', auth.authenticated, auth.organizer, scoped(async (req, planner, context) => {
  await planner.updateTrip(context, { travelers: req.body.travelers });
  return { redirect: `/plans/${context.trip.id}/share` };
}));

router.post('/plans/:id/invite/rotate', auth.authenticated, auth.organizer, scoped(async (req, planner, context) => {
  await planner.invite(context, true);
  return { redirect: `/plans/${context.trip.id}/share` };
}));

router.post('/plans/:id/members/:memberId/remove', auth.authenticated, auth.organizer, scoped(async (req, planner, context) => {
  await planner.removeMember(context, req.params.memberId);
  return { redirect: `/plans/${context.trip.id}/share` };
}));

router.get('/join/:token', async (req, res) => {
  const trip = await service(req).inviteTrip(req.params.token);
  if (req.viewer.isOrganizer || (req.viewer.tripId === trip.id && req.viewer.participantId)) return res.redirect(`/plans/${trip.id}`);
  if (req.membershipRevoked) throw auth.httpError(403, 'Your trip access has been removed. Ask the organizer for help.');
  auth.render(req, res, 'join', { trip: { name: trip.name, is_demo: trip.is_demo }, token: req.params.token, values: {} });
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
    auth.render(req, res, 'join', { trip: { name: trip.name, is_demo: trip.is_demo }, token: req.params.token, values: req.body }, error.message, 400);
  }
});

module.exports = router;