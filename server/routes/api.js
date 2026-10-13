// JSON API for agents (e.g. Hermes). Bearer-token only: no cookies, so no CSRF surface.
// Every call acts as the trip organizer and goes through the same PlannerService validation as the web UI.
const crypto = require('node:crypto');
const express = require('express');
const router = express.Router();
const { httpError, attempt } = require('../middleware/planner-auth');
const { PlannerService, tripValues } = require('../services/PlannerService');

const service = req => new PlannerService(req.app.get('pool'));
const ORGANIZER = { isOrganizer: true, name: 'API', participantId: null, tripId: null };

function safeEqual(a, b) {
  const x = crypto.createHash('sha256').update(a).digest();
  const y = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(x, y);
}

router.use((req, res, next) => {
  const expected = req.app.get('plannerConfig').apiToken;
  if (!expected) return next(httpError(404, 'API disabled.'));
  const match = /^Bearer\s+(\S+)$/.exec(req.get('Authorization') || '');
  // Reuse the persistent login limiter: blocked IPs stay blocked even with a correct token.
  attempt(req, 'api', 20, false).then(async () => {
    if (!match || !safeEqual(match[1], expected)) {
      await attempt(req, 'api', 20);
      res.set('WWW-Authenticate', 'Bearer');
      throw httpError(401, 'Invalid or missing API token.');
    }
    req.viewer = { ...ORGANIZER };
  }).then(() => next(), next);
});
router.use(express.json({ limit: '32kb', strict: true }));

// Run work inside the trip transaction as the organizer participant.
function scoped(handler) {
  return async (req, res) => {
    const planner = service(req);
    const result = await planner.withTrip(req.params.id, req.viewer, context => handler(req, planner, context));
    res.status(result?.status || 200).json(result?.body ?? result);
  };
}

const ideaFields = item => {
  if (!item) return item;
  const { author_name, voted, ...rest } = item;
  return { ...rest, author: author_name };
};

router.get('/trips', async (req, res) => {
  res.json({ trips: await service(req).list(req.viewer) });
});

router.post('/trips', async (req, res) => {
  const trip = await service(req).create(req.body || {}, req.viewer);
  res.status(201).json({ trip });
});

router.get('/trips/:id', scoped(async (req, planner, context) => {
  const board = await planner.board(context, {});
  return {
    trip: context.trip,
    members: board.members,
    ideas: board.items.map(ideaFields),
    selected_budget: board.budget,
    selected_origin_budget: board.originBudget,
    missing_costs: board.missingCosts,
  };
}));

router.patch('/trips/:id', scoped(async (req, planner, context) => {
  const merged = { ...context.trip, ...req.body };
  for (const key of ['travel_start', 'travel_end']) {
    if (merged[key] instanceof Date) merged[key] = merged[key].toISOString().slice(0, 10);
  }
  const v = tripValues(merged);
  const trip = await context.dao.trips.update(context.trip.id, v);
  return { trip };
}));

router.get('/trips/:id/ideas/:itemId', scoped(async (req, planner, context) => {
  const detail = await planner.ideaDetail(context, req.viewer, req.params.itemId);
  return { idea: ideaFields(detail.item), comments: detail.comments };
}));

router.post('/trips/:id/ideas', scoped(async (req, planner, context) => {
  const created = await planner.writeIdea(context, req.body || {});
  return { status: 201, body: { idea: ideaFields(await planner.item(context, created.id)) } };
}));

// PATCH merges with the stored idea so agents can send only the fields they change.
router.patch('/trips/:id/ideas/:itemId', scoped(async (req, planner, context) => {
  const existing = await planner.item(context, req.params.itemId);
  const merged = { ...existing, ...req.body };
  if (merged.quoted_at instanceof Date) merged.quoted_at = merged.quoted_at.toISOString().slice(0, 10);
  if (merged.cost != null) merged.cost = String(merged.cost);
  if (merged.capacity != null) merged.capacity = String(merged.capacity);
  if (merged.destination_id != null) merged.destination_id = String(merged.destination_id);
  if (merged.notes == null) merged.notes = '';
  if (merged.location == null) merged.location = '';
  if (!Object.hasOwn(req.body || {}, 'url')) delete merged.url;
  await planner.writeIdea(context, merged, existing);
  if (req.body?.status !== undefined) await planner.updateStatus(context, existing.id, req.body.status);
  return { idea: ideaFields(await planner.item(context, existing.id)) };
}));

router.delete('/trips/:id/ideas/:itemId', scoped(async (req, planner, context) => {
  await planner.removeIdea(context, req.viewer, req.params.itemId);
  return { deleted: true };
}));

router.post('/trips/:id/ideas/:itemId/sources', scoped(async (req, planner, context) => {
  const item = await planner.item(context, req.params.itemId);
  await planner.mutateReference(context, item, 'sources', 'add', null, req.body || {});
  return { status: 201, body: { sources: (await context.dao.sources.listForIdeas([item.id])) } };
}));

router.post('/trips/:id/ideas/:itemId/images', scoped(async (req, planner, context) => {
  const item = await planner.item(context, req.params.itemId);
  await planner.mutateReference(context, item, 'images', 'add', null, req.body || {});
  return { status: 201, body: { images: (await context.dao.images.listForIdeas([item.id])) } };
}));

router.post('/trips/:id/ideas/:itemId/comments', scoped(async (req, planner, context) => {
  const item = await planner.addComment(context, req.params.itemId, req.body?.body);
  return { status: 201, body: { comments: await context.dao.comments.listForIdea(item.id) } };
}));

router.patch('/trips/:id/members/:memberId', scoped(async (req, planner, context) => {
  return { member: await planner.setMemberOrigin(context, req.params.memberId, req.body?.origin) };
}));

// JSON errors for API clients; never echo bodies or tokens.
router.use((error, req, res, next) => {
  const status = [400, 401, 403, 404, 413, 429].includes(error.status) ? error.status : 500;
  if (status === 500) console.error('API request failed:', error.code || error.name);
  const message = status === 500 ? 'Something went wrong.' : error.type === 'entity.parse.failed' ? 'Invalid JSON body.' : error.message;
  res.status(status).json({ error: message, ...(error.field ? { field: error.field } : {}) });
});

module.exports = router;
