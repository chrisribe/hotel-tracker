const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { Pool } = require('pg');
const { createApp } = require('../app');

// Isolated random schema, same pattern as planner.test.js.
const schemaName = `api_test_${randomBytes(8).toString('hex')}`;
const connectionString = process.env.TEST_DATABASE_URL || 'postgresql://hotel:hotelpass@localhost:5432/hotel_tracker';
const TOKEN = randomBytes(32).toString('hex');
let adminPool, pool, app, server, base;

async function api(path, { method = 'GET', body, token = TOKEN } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${base}/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let json; try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: response.status, json, text, headers: response.headers };
}

before(async () => {
  adminPool = new Pool({ connectionString });
  await adminPool.query(`CREATE SCHEMA ${schemaName}`);
  pool = new Pool({ connectionString, options: `-c search_path=${schemaName}`, max: 8 });
  app = await createApp({ pool, config: { adminUser: 'org', adminPass: 'pw', cookieSecure: false, apiToken: TOKEN } });
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  app?.get('sessionStore').close();
  await pool?.end();
  if (adminPool) { await adminPool.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`); await adminPool.end(); }
});

test('API rejects missing, wrong, and non-bearer tokens and sets no session cookie', async () => {
  for (const token of [null, 'wrong', `${TOKEN}x`]) {
    const r = await api('/trips', { token });
    assert.equal(r.status, 401);
    assert.equal(r.json.error, 'Invalid or missing API token.');
    assert.equal(r.headers.get('set-cookie'), null);
  }
  const basic = await fetch(`${base}/api/v1/trips`, { headers: { Authorization: `Basic ${TOKEN}` } });
  assert.equal(basic.status, 401);
});

test('API is disabled (404) when no token is configured', async () => {
  const off = await createApp({ pool, config: { adminUser: 'org', adminPass: 'pw', cookieSecure: false, apiToken: '' } });
  const s = await new Promise(resolve => { const l = off.listen(0, '127.0.0.1', () => resolve(l)); });
  const r = await fetch(`http://127.0.0.1:${s.address().port}/api/v1/trips`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  assert.equal(r.status, 404);
  await new Promise(resolve => s.close(resolve));
  off.get('sessionStore').close();
});

test('agent workflow: trip, origins, per-origin flight quote, per-person villa, partial patch, sources, status', async () => {
  const created = await api('/trips', { method: 'POST', body: { name: 'Tiilteux 2027', travel_start: '2027-07-03', travel_end: '2027-07-17' } });
  assert.equal(created.status, 201);
  const tripId = created.json.trip.id;

  const board = await api(`/trips/${tripId}`);
  assert.equal(board.status, 200);
  const organizer = board.json.members.find(m => m.is_organizer);
  const member = await api(`/trips/${tripId}/members/${organizer.id}`, { method: 'PATCH', body: { origin: 'Montréal' } });
  assert.equal(member.status, 200);
  assert.equal(member.json.member.origin, 'Montréal');

  const dest = await api(`/trips/${tripId}/ideas`, { method: 'POST', body: { kind: 'destination', title: 'Açores' } });
  assert.equal(dest.status, 201);
  const flight = await api(`/trips/${tripId}/ideas`, { method: 'POST', body: {
    kind: 'transport', title: 'Vols vers Ponta Delgada', destination_id: dest.json.idea.id,
    cost_basis: 'per_person', price_kind: 'quoted', quoted_at: '2026-10-12',
    origin_costs: [{ origin: 'Montréal', cost: 706, currency: 'CAD' }, { origin: 'Paris', cost: '391', currency: 'EUR' }],
  } });
  assert.equal(flight.status, 201, flight.text);
  const f = flight.json.idea;
  assert.equal(f.cost_basis, 'per_person');
  assert.equal(f.price_kind, 'quoted');
  assert.deepEqual(f.origin_costs.map(o => [o.origin, Number(o.cost), o.currency]), [['Montréal', 706, 'CAD'], ['Paris', 391, 'EUR']]);

  const villa = await api(`/trips/${tripId}/ideas`, { method: 'POST', body: {
    kind: 'stay', title: 'Casa da Caloura', cost: 7985, currency: 'CAD', capacity: 6, cost_basis: 'total',
    price_kind: 'quoted', quoted_at: '2026-10-12', url: 'https://www.airbnb.ca/rooms/1',
  } });
  assert.equal(villa.status, 201, villa.text);
  const v = villa.json.idea;
  assert.equal(Number(v.cost), 7985);
  assert.equal(v.source_count, 1);

  // Partial PATCH: only the price changes; origin costs, url, basis are preserved.
  const patched = await api(`/trips/${tripId}/ideas/${f.id}`, { method: 'PATCH', body: { notes: 'Direct flights both sides' } });
  assert.equal(patched.status, 200, patched.text);
  assert.equal(patched.json.idea.notes, 'Direct flights both sides');
  assert.equal(patched.json.idea.origin_costs.length, 2);
  assert.equal(patched.json.idea.cost_basis, 'per_person');
  assert.equal(patched.json.idea.price_kind, 'quoted');

  const repriced = await api(`/trips/${tripId}/ideas/${f.id}`, { method: 'PATCH', body: { origin_costs: [{ origin: 'Paris', cost: 402, currency: 'EUR' }], status: 'shortlisted' } });
  assert.equal(repriced.status, 200, repriced.text);
  assert.deepEqual(repriced.json.idea.origin_costs.map(o => o.origin), ['Paris']);
  assert.equal(repriced.json.idea.status, 'shortlisted');

  const source = await api(`/trips/${tripId}/ideas/${v.id}/sources`, { method: 'POST', body: { label: 'Kayak', url: 'https://www.kayak.com/x', takeaway: 'Checked 2026-10-12' } });
  assert.equal(source.status, 201);
  assert.equal(source.json.sources.length, 2);

  const comment = await api(`/trips/${tripId}/ideas/${v.id}/comments`, { method: 'POST', body: { body: 'Ajouté par Hermes' } });
  assert.equal(comment.status, 201);

  const select = await api(`/trips/${tripId}/ideas/${v.id}`, { method: 'PATCH', body: { status: 'selected' } });
  assert.equal(select.status, 200);
  const after = await api(`/trips/${tripId}`);
  assert.deepEqual(after.json.selected_budget.map(b => [b.currency, b.cost_basis, Number(b.total)]), [['CAD', 'total', 7985]]);

  const detail = await api(`/trips/${tripId}/ideas/${v.id}`);
  assert.equal(detail.json.comments[0].body, 'Ajouté par Hermes');

  const gone = await api(`/trips/${tripId}/ideas/${v.id}`, { method: 'DELETE' });
  assert.equal(gone.status, 200);
  assert.equal((await api(`/trips/${tripId}/ideas/${v.id}`)).status, 404);
});

test('API validation errors are JSON 400s with clear messages', async () => {
  const tripId = (await api('/trips', { method: 'POST', body: { name: 'Validation' } })).json.trip.id;
  const cases = [
    [{ kind: 'stay', title: 'x', cost_basis: 'per_week' }, /cost basis/],
    [{ kind: 'stay', title: 'x', price_kind: 'guess' }, /price kind/],
    [{ kind: 'stay', title: 'x', quoted_at: '2026-10-12' }, /quote date only applies/],
    [{ kind: 'stay', title: 'x', origin_costs: [{ origin: 'A', cost: 1 }, { origin: 'a', cost: 2 }] }, /listed twice/],
    [{ kind: 'stay', title: 'x', origin_costs: [{ origin: 'A', cost: -1 }] }, /non-negative/],
    [{ kind: 'stay', title: 'x', origin_costs: [{ origin: 'A', cost: 1, currency: 'JPY' }] }, /currency/],
    [{ kind: 'stay', title: '' }, /Title/],
  ];
  for (const [body, pattern] of cases) {
    const r = await api(`/trips/${tripId}/ideas`, { method: 'POST', body });
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.match(r.json.error, pattern);
  }
  const bad = await fetch(`${base}/api/v1/trips`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: '{nope' });
  assert.equal(bad.status, 400);
  assert.equal((await api('/trips/999999')).status, 404);
});

test('web form accepts the new cost fields and origin-cost text lines', async () => {
  // Use the service directly through the form parser path (string inputs, as a browser sends them).
  const { ideaValues } = require('../services/PlannerService');
  const v = ideaValues({ kind: 'transport', title: 'Vols', cost_basis: 'per_person', price_kind: 'quoted', quoted_at: '2026-10-12',
    origin_costs: 'Montréal: 854 CAD\nParis: 210,50 EUR\n' });
  assert.deepEqual(v.origin_costs, [{ origin: 'Montréal', cost: '854', currency: 'CAD' }, { origin: 'Paris', cost: '210.50', currency: 'EUR' }]);
  assert.throws(() => ideaValues({ kind: 'transport', title: 'Vols', origin_costs: 'Montréal 854' }), /Origin: amount CUR/);
});
