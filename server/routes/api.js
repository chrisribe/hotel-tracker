const express = require('express');
const auth = require('../middleware/planner-auth');
const { PlannerService, TRIP_FIELDS, IDEA_FIELDS, dateText, perPerson } = require('../services/PlannerService');

const AGENT_NAME = 'Hermes';
const FAILED_TOKEN_LIMIT = 20;
const CLIENT_ERRORS = [400, 401, 403, 404, 413, 429];

const router = express.Router();
const service = req => new PlannerService(req.app.get('pool'));

router.use(requireToken);
router.use(express.json({ limit: '32kb', strict: true }));

// ── Trips ────────────────────────────────────────────────────────────

router.get('/trips', async (req, res) => {
  const trips = await service(req).list(req.viewer);
  res.json({ trips: trips.map(tripJson) });
});

router.post('/trips', onlyFields(TRIP_FIELDS), async (req, res) => {
  // Trips belong to the organizer, not the assistant.
  const organizer = { ...req.viewer, name: req.app.get('plannerConfig').adminUser };
  const trip = await service(req).create(req.body, organizer);
  res.status(201).json({ trip: tripJson(trip) });
});

router.get('/trips/:id', inTrip(async (req, planner, ctx) => {
  const board = await planner.board(ctx, {});
  return {
    trip: tripJson(board.trip),
    members: board.members,
    destinations: board.destinations,
    ideas: board.items.map(idea => ideaJson(idea, board.trip)),
    budget: board.budget.map(b => ({ ...b, per_person: perPerson(b.total, board.trip.travelers) })),
    missing_costs: board.missingCosts,
  };
}));

router.patch('/trips/:id', onlyFields(TRIP_FIELDS), inTrip(async (req, planner, ctx) => {
  const trip = await planner.updateTrip(ctx, req.body);
  return { trip: tripJson(trip) };
}));

// ── Ideas ────────────────────────────────────────────────────────────

router.post('/trips/:id/ideas', onlyFields([...IDEA_FIELDS, 'source_label', 'takeaway']), inTrip(async (req, planner, ctx) => {
  const item = await planner.writeIdea(ctx, req.body);
  return showIdea(req, planner, ctx, item.id);
}, 201));

router.get('/trips/:id/ideas/:itemId', inTrip((req, planner, ctx) =>
  showIdea(req, planner, ctx, req.params.itemId)));

router.patch('/trips/:id/ideas/:itemId', onlyFields([...IDEA_FIELDS, 'status']), inTrip(async (req, planner, ctx) => {
  const item = await planner.patchIdea(ctx, req.viewer, req.params.itemId, req.body);
  return showIdea(req, planner, ctx, item.id);
}));

router.delete('/trips/:id/ideas/:itemId', inTrip(async (req, planner, ctx) => {
  await planner.removeIdea(ctx, req.viewer, req.params.itemId);
  return { deleted: true };
}));

// ── Sources, images, comments ────────────────────────────────────────

const REFERENCE_FIELDS = { sources: ['label', 'url', 'takeaway'], images: ['url', 'caption', 'source_url'] };
for (const collection of ['sources', 'images']) {
  router.post(`/trips/:id/ideas/:itemId/${collection}`, onlyFields(REFERENCE_FIELDS[collection]), inTrip(async (req, planner, ctx) => {
    const item = await planner.item(ctx, req.params.itemId);
    await planner.mutateReference(ctx, item, collection, 'add', null, req.body);
    return showIdea(req, planner, ctx, item.id);
  }, 201));
}

router.post('/trips/:id/ideas/:itemId/comments', onlyFields(['body']), inTrip(async (req, planner, ctx) => {
  const item = await planner.addComment(ctx, req.params.itemId, req.body.body);
  return showIdea(req, planner, ctx, item.id);
}, 201));

router.use((req, res, next) => next(auth.httpError(404, 'Not found.')));
router.use(sendError);

// ── Helpers ──────────────────────────────────────────────────────────

async function requireToken(req, res, next) {
  const { apiToken } = req.app.get('plannerConfig');
  if (!apiToken) throw auth.httpError(404, 'API disabled.');

  // Only failed tokens count toward the limit.
  await auth.ensureNotBlocked(req, 'api', FAILED_TOKEN_LIMIT);
  const [, token] = /^Bearer\s+(\S+)$/.exec(req.get('Authorization') || '') || [];
  if (!token || !auth.safeEqual(token, apiToken)) {
    await auth.attempt(req, 'api', FAILED_TOKEN_LIMIT);
    res.set('WWW-Authenticate', 'Bearer');
    throw auth.httpError(401, 'Invalid or missing API token.');
  }

  // Organizer-level access. Reads have no side effects; writes are credited to the trip's assistant member.
  const isWrite = !['GET', 'HEAD'].includes(req.method);
  req.viewer = { isOrganizer: true, isAgent: isWrite, name: AGENT_NAME, participantId: null, tripId: null };
  next();
}

// Rejects bodies that are not a JSON object or carry fields the endpoint would silently drop.
function onlyFields(allowed) {
  return (req, res, next) => {
    const body = req.body;
    if (body === null || typeof body !== 'object' || Array.isArray(body)) throw auth.httpError(400, 'Body must be a JSON object.');
    const unknown = Object.keys(body).find(key => !allowed.includes(key));
    if (unknown) {
      const error = auth.httpError(400, `Unknown field "${unknown}". Allowed: ${allowed.join(', ')}.`);
      error.field = unknown;
      throw error;
    }
    next();
  };
}

// Runs the handler inside the trip's transaction and sends what it returns as JSON.
function inTrip(handler, status = 200) {
  return async (req, res) => {
    const planner = service(req);
    const body = await planner.withTrip(req.params.id, req.viewer, ctx => handler(req, planner, ctx));
    res.status(status).json(body);
  };
}

async function showIdea(req, planner, ctx, itemId) {
  const { item, comments } = await planner.ideaDetail(ctx, req.viewer, itemId);
  return { idea: ideaJson(item, ctx.trip), comments };
}

function tripJson(trip) {
  return { ...trip, travel_start: dateText(trip.travel_start), travel_end: dateText(trip.travel_end) };
}

// per_person is an estimate: total cost ÷ the trip's travelers (null if either is unknown).
function ideaJson({ author_name, voted, ...idea }, trip) {
  return { ...idea, author: author_name, per_person: perPerson(idea.cost, trip.travelers) };
}

// Express needs all four parameters to treat this as an error handler.
function sendError(error, req, res, _next) {
  const status = CLIENT_ERRORS.includes(error.status) ? error.status : 500;
  if (status === 500) console.error('API request failed:', error.code || error.name);
  if (status === 429) res.set('Retry-After', '900');
  const body = { error: errorMessage(error, status) };
  if (error.field) body.field = error.field;
  res.status(status).json(body);
}

function errorMessage(error, status) {
  if (status === 500) return 'Something went wrong.';
  if (status === 413) return 'Request body is too large.';
  if (error.type === 'entity.parse.failed') return 'Invalid JSON body.';
  return error.message;
}

module.exports = router;
