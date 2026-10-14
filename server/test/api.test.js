const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { Pool } = require('pg');
const { createApp } = require('../app');

const schemaName = `api_test_${randomBytes(8).toString('hex')}`;
const connectionString = process.env.TEST_DATABASE_URL || 'postgresql://hotel:hotelpass@localhost:5432/hotel_tracker';
const TOKEN = randomBytes(32).toString('hex');
const config = { adminUser: 'test-organizer', adminPass: 'test-password', cookieSecure: false, apiToken: TOKEN };
let adminPool, pool;
const servers = [];

async function start(overrides = {}) {
  const app = await createApp({ pool, config: { ...config, ...overrides } });
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  servers.push({ server, app });
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  return async (path, { method = 'GET', body, raw, token = TOKEN } = {}) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined || raw !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${base}${path}`, { method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
    return { status: response.status, headers: response.headers, json: await response.json() };
  };
}

let api;
before(async () => {
  adminPool = new Pool({ connectionString });
  await adminPool.query(`CREATE SCHEMA ${schemaName}`);
  pool = new Pool({ connectionString, options: `-c search_path=${schemaName}`, max: 8 });
  api = await start();
});

beforeEach(async () => { await pool.query('DELETE FROM planner_attempts'); });

after(async () => {
  for (const { server, app } of servers) {
    await new Promise(resolve => server.close(resolve));
    app.get('sessionStore').close();
  }
  await pool?.end();
  if (adminPool) {
    await adminPool.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
    await adminPool.end();
  }
});

test('API is off without a token and rejects short tokens', async () => {
  for (const apiToken of ['', 'too-short']) {
    const disabled = await start({ apiToken });
    const response = await disabled('/trips');
    assert.equal(response.status, 404);
    assert.deepEqual(response.json, { error: 'API disabled.' });
  }
});

test('only failed tokens count toward the rate limit', async () => {
  const missing = await api('/trips', { token: null });
  assert.equal(missing.status, 401);
  assert.equal(missing.headers.get('www-authenticate'), 'Bearer');
  assert.equal((await api('/trips', { token: `${TOKEN}x` })).status, 401);
  for (let i = 0; i < 25; i++) assert.equal((await api('/trips')).status, 200);
  for (let i = 0; i < 18; i++) assert.equal((await api('/trips', { token: 'wrong' })).status, 401);
  const blocked = await api('/trips');
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('retry-after'), '900');
});

test('an agent researches a trip end to end with its own attribution', async () => {
  const created = await api('/trips', { method: 'POST', body: { name: 'Coast week', travel_start: '2026-11-01' } });
  assert.equal(created.status, 201);
  const tripId = created.json.trip.id;
  assert.equal(created.json.trip.travel_start, '2026-11-01');

  // Reads never add the assistant as a member.
  let board = await api(`/trips/${tripId}`);
  assert.deepEqual(board.json.members.map(m => m.name), ['test-organizer']);

  const patched = await api(`/trips/${tripId}`, { method: 'PATCH', body: { description: 'Eight friends', travel_end: '2026-11-08' } });
  assert.equal(patched.status, 200);
  assert.deepEqual([patched.json.trip.name, patched.json.trip.description, patched.json.trip.travel_start, patched.json.trip.travel_end],
    ['Coast week', 'Eight friends', '2026-11-01', '2026-11-08']);

  const destination = await api(`/trips/${tripId}/ideas`, { method: 'POST', body: { kind: 'destination', title: 'Tofino' } });
  assert.equal(destination.status, 201);
  const stay = await api(`/trips/${tripId}/ideas`, { method: 'POST', body: {
    kind: 'stay', title: 'Beach house', cost: 7985, capacity: 8, currency: 'CAD', destination_id: destination.json.idea.id,
    url: 'https://example.com/house', source_label: 'Listing', takeaway: 'Sleeps eight' } });
  assert.equal(stay.status, 201);
  const ideaPath = `/trips/${tripId}/ideas/${stay.json.idea.id}`;
  assert.equal(stay.json.idea.author, 'Hermes');
  assert.equal(stay.json.idea.cost, '7985.00');
  assert.equal(stay.json.idea.capacity, 8);
  assert.equal(stay.json.idea.sources[0].takeaway, 'Sleeps eight');
  assert.equal(Object.hasOwn(stay.json.idea, 'voted'), false);

  assert.equal((await api(`${ideaPath}/sources`, { method: 'POST', body: { label: 'Reviews', url: 'https://example.com/reviews' } })).json.idea.sources.length, 2);
  assert.equal((await api(`${ideaPath}/images`, { method: 'POST', body: { url: 'https://images.example.com/house.jpg', caption: 'Deck' } })).json.idea.images[0].is_cover, true);
  const commented = await api(`${ideaPath}/comments`, { method: 'POST', body: { body: 'Free cancellation until Oct 1.' } });
  assert.equal(commented.status, 201);
  assert.equal(commented.json.comments[0].body, 'Free cancellation until Oct 1.');

  const updated = await api(ideaPath, { method: 'PATCH', body: { cost: '8100.50', status: 'selected' } });
  assert.equal(updated.status, 200);
  assert.deepEqual([updated.json.idea.cost, updated.json.idea.status, updated.json.idea.title, updated.json.idea.capacity, updated.json.idea.url],
    ['8100.50', 'selected', 'Beach house', 8, 'https://example.com/house']);

  board = await api(`/trips/${tripId}`);
  assert.equal(board.json.ideas.length, 2);
  assert.deepEqual(board.json.members.map(m => [m.name, m.is_agent]), [['test-organizer', false], ['Hermes', true]]);
  assert.deepEqual(board.json.budget, [{ currency: 'CAD', total: '8100.50' }]);
  assert.equal(board.json.missing_costs, 0);
  assert.deepEqual((await api('/trips')).json.trips.map(t => t.name), ['Coast week']);

  assert.deepEqual((await api(ideaPath, { method: 'DELETE' })).json, { deleted: true });
  assert.deepEqual((await api(ideaPath)).json, { error: 'Idea not found.' });

  // Removing the assistant from a trip blocks its writes there.
  await pool.query('UPDATE participants SET active = FALSE WHERE trip_id = $1 AND is_agent', [tripId]);
  assert.equal((await api(`/trips/${tripId}/ideas`, { method: 'POST', body: { title: 'Kayak tour' } })).status, 403);
  assert.equal((await api(`/trips/${tripId}`)).status, 200);
});

test('API validation errors are JSON', async () => {
  const tripId = (await api('/trips', { method: 'POST', body: { name: 'Validation trip' } })).json.trip.id;
  const ideas = `/trips/${tripId}/ideas`;
  const cases = [
    [{ kind: 'stay' }, 'Title is required and must be at most 160 characters.'],
    [{ title: 'Bad cost', cost: 0.1 + 0.2 }, /Cost must be/],
    [{ title: 'Negative', cost: -5 }, /Cost must be/],
    [{ title: 'Bad kind', kind: 'castle' }, 'Invalid idea kind.'],
  ];
  for (const [body, message] of cases) {
    const response = await api(ideas, { method: 'POST', body });
    assert.equal(response.status, 400);
    assert.match(response.json.error, message instanceof RegExp ? message : new RegExp(`^${message.replace(/\./g, '\\.')}$`));
  }
  const idea = (await api(ideas, { method: 'POST', body: { title: 'Valid' } })).json.idea;
  const image = await api(`${ideas}/${idea.id}/images`, { method: 'POST', body: { url: 'http://example.com/a.jpg' } });
  assert.equal(image.status, 400);
  assert.equal(image.json.field, 'url');
  assert.equal((await api(`/trips/${tripId}`, { method: 'PATCH', body: { name: '' } })).status, 400);
  assert.deepEqual((await api(ideas, { method: 'POST', raw: '{"title":' })).json, { error: 'Invalid JSON body.' });
  assert.equal((await api(ideas, { method: 'POST', raw: JSON.stringify({ title: 'x'.repeat(40000) }) })).status, 413);
  assert.deepEqual((await api('/trips/abc')).json, { error: 'Invalid trip.' });
  assert.deepEqual((await api('/trips/999999')).json, { error: 'Trip not found.' });
  assert.deepEqual((await api('/nope')).json, { error: 'Not found.' });
});
