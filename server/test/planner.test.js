const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { Pool } = require('pg');
const { createApp } = require('../app');
const { migrate } = require('../scripts/init-db');

// Only the randomly named schema is created/dropped; never reset the application schema.
const schemaName = `planner_test_${randomBytes(8).toString('hex')}`;
const connectionString = process.env.TEST_DATABASE_URL || 'postgresql://hotel:hotelpass@localhost:5432/hotel_tracker';
let adminPool, pool, app, server, base;
const config = { adminUser: 'test-organizer', adminPass: 'test-password', cookieSecure: false };

async function listen(overrides = {}) {
  app = await createApp({ pool, config: { ...config, ...overrides } });
  // Compile the real EJS pages as well as exercising HTTP/session/database behavior.
  // Return the data alongside the HTML so authorization and rendering can both be asserted.
  const render = app.render.bind(app);
  app.render = (view, locals, callback) => {
    return render(view, locals, (error, html) =>
      callback(error, error ? undefined : JSON.stringify({ template: view, ...locals, html })));
  };
  server = await new Promise(resolve => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  base = `http://127.0.0.1:${server.address().port}`;
}

async function close() {
  if (server) await new Promise(resolve => server.close(resolve));
  app?.get('sessionStore').close();
}

function browser(baseUrl) {
  let cookie = '', csrf = '';
  return {
    async request(path, { method = 'GET', body, headers = {}, token = true } = {}) {
      const options = { method, redirect: 'manual', headers: { Cookie: cookie, ...headers } };
      if (body !== undefined) {
        options.body = new URLSearchParams({ ...(token ? { _csrf: csrf } : {}), ...body });
      }
      const response = await fetch(`${baseUrl || base}${path}`, options);
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      const text = await response.text();
      let page;
      try { page = JSON.parse(text); } catch { /* Redirects and legacy plain text. */ }
      if (page?.csrfToken) csrf = page.csrfToken;
      return { status: response.status, location: response.headers.get('location'), page, text, setCookie, headers: response.headers };
    },
    get cookie() { return cookie; },
    async post(path, body = {}, options = {}) { return this.request(path, { method: 'POST', body, ...options }); },
    async login() {
      await this.request('/login');
      return this.post('/login', { username: config.adminUser, password: config.adminPass });
    },
  };
}

before(async () => {
  adminPool = new Pool({ connectionString });
  await adminPool.query(`CREATE SCHEMA ${schemaName}`);
  pool = new Pool({ connectionString, options: `-c search_path=${schemaName}`, max: 8 });
  await listen();
});

// Independent scenarios share one isolated schema/IP, not one rate-limit history.
// The dedicated rate-limit test still verifies persistence across restart within its scenario.
beforeEach(async () => { await pool.query('DELETE FROM planner_attempts'); });

after(async () => {
  await close();
  await pool?.end();
  if (adminPool) {
    await adminPool.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
    await adminPool.end();
  }
});

test('fresh startup migrates idempotently and organizer sessions survive app restart', async () => {
  await Promise.all([migrate(pool), migrate(pool)]);
  const visitor = browser();
  assert.equal((await visitor.request('/')).location, '/plans');
  const denied = await visitor.request('/plans');
  assert.equal(denied.location, '/login');
  assert.equal(denied.headers.get('www-authenticate'), null);
  const login = await browser().request('/login');
  await visitor.request('/login');
  assert.equal(login.page.view, 'login');
  assert.match(login.setCookie, /HttpOnly/);
  assert.match(login.setCookie, /SameSite=Lax/);
  const oldCookie = visitor.cookie;
  assert.equal((await visitor.post('/login', { username: config.adminUser, password: config.adminPass })).location, '/plans');
  assert.notEqual(visitor.cookie, oldCookie);
  const plans = await visitor.request('/plans');
  assert.equal(plans.page.viewer.isOrganizer, true);
  assert.deepEqual(plans.page.data.trips, []);
  await close();
  await listen();
  assert.equal((await visitor.request('/plans')).page.viewer.isOrganizer, true);
});

test('organizer creates trips, invite joins are scoped, and guests contribute with attribution', async () => {
  const owner = browser(), guest = browser(), outsider = browser();
  await owner.login();
  await owner.request('/plans');
  const created = await owner.post('/plans', { name: 'Private research', description: 'Flexible destination' });
  assert.match(created.location || '', /^\/plans\/\d+$/);
  const boardPath = created.location;
  const second = await owner.post('/plans', { name: 'Another private trip' });
  const share = await owner.request(`${boardPath}/share`);
  const invite = share.page.data.invitePath;
  const preview = await guest.request(invite);
  assert.deepEqual(Object.keys(preview.page.data.trip).sort(), ['is_demo', 'name']);
  assert.equal(preview.page.view, 'join');
  assert.equal((await guest.post(invite, { name: 'Alex' })).location, boardPath);
  assert.equal((await guest.request(invite)).location, boardPath);
  assert.equal((await guest.request('/plans')).page.data.trips.length, 1);
  assert.equal((await guest.request(second.location)).status, 404);
  assert.equal((await guest.request(`${boardPath}/share`)).status, 403);
  assert.equal((await outsider.request(boardPath)).location, '/login');
  await guest.request(`${boardPath}/ideas/new`);
  const contribution = await guest.post(`${boardPath}/ideas`, { kind: 'stay', title: 'A guest idea', cost: '1200.50', currency: 'CAD' });
  assert.match(contribution.location || '', /\/ideas\/\d+$/);
  const detail = await guest.request(contribution.location);
  assert.equal(detail.page.data.item.author_name, 'Alex');
  assert.equal(detail.page.data.canEdit, true);
  const board = await guest.request(boardPath);
  assert.equal(board.page.data.items.length, 1);
  assert.equal(board.page.data.counts.stay, 1);
  assert.deepEqual(board.page.data.budget, []);
  assert.equal(board.page.viewer.tripId, board.page.data.trip.id);
  await close();
  await listen();
  assert.equal((await guest.request(boardPath)).page.viewer.name, 'Alex');
  assert.equal((await guest.request(second.location)).status, 404);
});

async function group() {
  const owner = browser(), alice = browser(), bob = browser();
  await owner.login();
  await owner.request('/plans');
  const path = (await owner.post('/plans', { name: 'Integration group' })).location;
  const invite = (await owner.request(`${path}/share`)).page.data.invitePath;
  for (const [person, name] of [[alice, 'Alice'], [bob, 'Bob']]) {
    await person.request(invite);
    assert.equal((await person.post(invite, { name })).location, path);
    await person.request(path);
  }
  return { owner, alice, bob, path, invite };
}

async function idea(person, path, values) {
  const result = await person.post(`${path}/ideas`, { kind: 'stay', title: 'Test idea', ...values });
  assert.equal(result.status, 302, result.text);
  return result.location;
}

test('authors edit/delete their own ideas, votes toggle uniquely, and comments remain attributed', async () => {
  const { owner, alice, bob, path } = await group();
  const item = await idea(alice, path, {});
  assert.equal((await bob.request(`${item}/edit`)).status, 403);
  assert.equal((await bob.post(`${item}/edit`, { title: 'Stolen', kind: 'stay' })).status, 403);
  assert.equal((await bob.post(`${item}/delete`)).status, 403);
  assert.equal((await bob.post(`${item}/status`, { status: 'booked' })).status, 403);
  assert.equal((await alice.request(`${item}/edit`)).page.data.formAction, `${item}/edit`);
  assert.equal((await alice.post(`${item}/edit`, { title: 'Edited', kind: 'activity', currency: 'EUR', status: 'booked' })).status, 302);
  assert.equal((await alice.request(item)).page.data.item.status, 'considering');
  assert.equal((await bob.post(`${item}/vote`)).status, 302);
  let detail = (await bob.request(item)).page.data;
  assert.equal(detail.item.vote_count, 1);
  assert.equal(detail.item.voted, true);
  await bob.post(`${item}/vote`);
  assert.equal((await bob.request(item)).page.data.item.vote_count, 0);
  await Promise.all([bob.post(`${item}/vote`), bob.post(`${item}/vote`)]);
  assert.equal((await bob.request(item)).page.data.item.vote_count, 0);
  assert.equal((await bob.post(`${item}/comments`, { body: 'Worth discussing <script>alert(1)</script>' })).status, 302);
  detail = (await alice.request(item)).page.data;
  assert.equal(detail.comments[0].author_name, 'Bob');
  assert.equal(detail.comments[0].body, 'Worth discussing <script>alert(1)</script>');
  assert.equal((await bob.post(`${item}/comments`, { body: 'x'.repeat(2001) })).status, 400);
  assert.equal((await owner.post(`${item}/status`, { status: 'invalid' })).status, 400);
  assert.equal((await owner.post(`${item}/edit`, { title: 'Organizer edit', kind: 'activity' })).status, 302);
  assert.equal((await alice.post(`${item}/delete`)).location, path);
  assert.equal((await owner.request(item)).status, 404);
});

test('only selected cost-bearing quotes enter separate-currency budgets; filters and destinations are trip-scoped', async () => {
  const { owner, alice, path } = await group();
  const destination = await idea(owner, path, { kind: 'destination', title: 'Option A', cost: '99999' });
  const destinationId = destination.split('/').at(-1);
  const stay = await idea(alice, path, { title: 'Quoted stay', destination_id: destinationId, cost: '1200.50' });
  const transport = await idea(alice, path, { kind: 'transport', title: 'Transport', cost: '50.25', currency: 'USD' });
  const missing = await idea(alice, path, { kind: 'activity', title: 'Unquoted activity' });
  const link = await idea(alice, path, { kind: 'link', title: 'Not an expense', cost: '100000' });
  await idea(alice, path, { title: 'Unselected alternative', cost: '5000' });
  for (const item of [destination, stay, missing, link]) assert.equal((await owner.post(`${item}/status`, { status: 'selected' })).status, 302);
  await owner.post(`${transport}/status`, { status: 'booked' });
  const board = (await owner.request(path)).page.data;
  assert.deepEqual(board.budget, [{ currency: 'CAD', total: '1200.50' }, { currency: 'USD', total: '50.25' }]);
  assert.equal(board.missingCosts, 1);
  assert.equal(board.counts.all, 6);
  assert.equal(board.counts.shortlisted, 0);
  assert.equal(board.counts.selected, 5);
  assert.equal((await alice.request(`${path}?kind=stay&destination=${destinationId}&q=quoted&view=selected`)).page.data.items.length, 1);
  assert.equal((await alice.request(`${path}?q=${encodeURIComponent("' OR 1=1 --")}`)).page.data.items.length, 0);
  const other = (await owner.post('/plans', { name: 'Secret second trip' })).location;
  const foreignDestination = await idea(owner, other, { kind: 'destination', title: 'Secret destination' });
  const foreignId = foreignDestination.split('/').at(-1);
  const foreignThroughOwnTrip = `${path}/ideas/${foreignId}`;
  for (const suffix of ['', '/edit']) assert.equal((await alice.request(foreignThroughOwnTrip + suffix)).status, 404);
  for (const suffix of ['/vote', '/comments', '/edit', '/delete']) {
    assert.equal((await alice.post(foreignThroughOwnTrip + suffix, { body: 'No', title: 'No' })).status, 404);
  }
  assert.equal((await alice.post(`${path}/ideas`, { kind: 'stay', title: 'Invalid link', destination_id: foreignId })).status, 400);
  assert.equal((await alice.request(`${path}?destination=${foreignId}`)).status, 400);
  assert.equal((await owner.post(`${destination}/edit`, { kind: 'stay', title: 'Referenced destination' })).status, 400);
  assert.equal((await owner.post(`${destination}/delete`)).status, 302);
  assert.equal((await alice.request(stay)).page.data.item.destination_id, null);
});

test('invite rotation stops new joins, organizer identity survives invite links, and removal revokes sessions', async () => {
  const { owner, alice, bob, path, invite } = await group();
  const item = await idea(alice, path, { title: 'Preserve attribution' });
  const before = (await owner.request(`${path}/share`)).page.data;
  const organizerMember = before.members.find(m => m.is_organizer);
  const aliceMember = before.members.find(m => m.name === 'Alice');
  assert.equal((await owner.post(`${path}/members/${organizerMember.id}/remove`)).status, 403);
  assert.equal((await owner.request(invite)).location, path);
  assert.equal((await owner.post(invite, { name: 'Not a guest' })).location, path);
  assert.equal((await owner.request('/plans')).page.viewer.isOrganizer, true);
  assert.equal((await owner.post(`${path}/invite/rotate`)).location, `${path}/share`);
  const freshInvite = (await owner.request(`${path}/share`)).page.data.invitePath;
  assert.notEqual(invite, freshInvite);
  assert.equal((await browser().request(invite)).status, 404);
  assert.equal((await bob.request(path)).status, 200);
  assert.equal((await alice.post(`${path}/invite/rotate`)).status, 403);
  assert.equal((await owner.post(`${path}/members/${aliceMember.id}/remove`)).status, 302);
  assert.equal((await alice.request(path)).status, 403);
  assert.equal((await alice.post(`${item}/comments`, { body: 'Revoked' })).status, 403);
  assert.equal((await alice.request(freshInvite)).status, 403);
  assert.equal((await alice.post(freshInvite, { name: 'Evade removal' })).status, 403);
  assert.equal((await owner.request(item)).page.data.item.author_name, 'Alice');
  const newcomer = browser();
  await newcomer.request(freshInvite);
  assert.equal((await newcomer.post(freshInvite, { name: 'New member' })).location, path);
});

test('validation preserves input, rejects unsafe URLs/dates and enforces CSRF, origin and body limits', async () => {
  const { owner, alice, path } = await group();
  for (const dates of [
    { travel_start: '2026-02-30' }, { travel_end: '2026-13-01' },
    { travel_start: '2026-10-20', travel_end: '2026-10-19' }, { travel_start: '0000-01-01' },
  ]) {
    const invalid = await owner.post('/plans', { name: 'Kept title', ...dates });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.page.data.values.name, 'Kept title');
  }
  assert.equal((await owner.post('/plans', { name: 'x'.repeat(121) })).status, 400);
  assert.equal((await owner.post('/plans', { name: 'Valid leap date', travel_start: '2028-02-29', travel_end: '2028-02-29' })).status, 302);
  for (const url of ['javascript:alert(1)', 'data:text/html,test', 'ftp://example.com', 'https://user:pass@example.com', '/relative', 'https://example.com/white space']) {
    const invalid = await alice.post(`${path}/ideas`, { title: 'Keep me', kind: 'link', url });
    assert.equal(invalid.status, 400, url);
    assert.equal(invalid.page.view, 'idea-form');
    assert.equal(invalid.page.data.values.title, 'Keep me');
    assert.equal(invalid.page.data.values.url, url);
  }
  for (const invalid of [{ kind: 'bad' }, { cost: '-1' }, { cost: '1.999' }, { cost: 'NaN' },
    { currency: 'BTC' }, { capacity: '1.5' }, { capacity: '100001' }, { notes: 'x'.repeat(10001) }]) {
    assert.equal((await alice.post(`${path}/ideas`, { title: 'Validation', ...invalid })).status, 400);
  }
  assert.equal((await alice.post(`${path}/ideas`, { title: 'No CSRF' }, { token: false })).status, 403);
  assert.equal((await alice.post(`${path}/ideas`, { title: 'Bad CSRF', _csrf: 'wrong' })).status, 403);
  assert.equal((await alice.post(`${path}/ideas`, { title: 'Cross-site' }, { headers: { Origin: 'https://attacker.example' } })).status, 403);
  assert.equal((await alice.post(`${path}/ideas`, { title: 'Cross-site fetch' }, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await alice.post(`${path}/ideas`, { title: 'Cross-site referer' }, { headers: { Referer: 'https://attacker.example/form' } })).status, 403);
  assert.equal((await alice.post(`${path}/ideas`, { title: 'Too big', notes: 'x'.repeat(40000) })).status, 413);
  for (const query of ['kind=bad', 'view=bad', 'destination=0', 'q=' + 'x'.repeat(201)]) {
    assert.equal((await alice.request(`${path}?${query}`)).status, 400);
  }
  const form = await alice.request(`${path}/ideas/new`);
  for (const field of ['view', 'title', 'data', 'viewer', 'csrfToken', 'error']) assert.ok(Object.hasOwn(form.page, field));
  assert.deepEqual(form.page.data.trips, []);
  const count = (await alice.request(path)).page.data.items.length;
  const getMutation = await alice.request(`${path}/invite/rotate`);
  assert.equal(getMutation.status, 404);
  assert.equal((await alice.request(path)).page.data.items.length, count);
  assert.equal((await alice.post('/logout')).location, '/login');
  assert.equal((await alice.request(path)).location, '/login');
});

test('demo is explicit, fictional, and concurrent/idempotent; GET pages do not change trip metadata', async () => {
  const owner = browser();
  await owner.login();
  const list = (await owner.request('/plans')).page.data.trips;
  assert.equal(list.some(t => t.is_demo), false);
  const results = await Promise.all([owner.post('/plans/demo'), owner.post('/plans/demo')]);
  assert.equal(results[0].location, results[1].location);
  const board = (await owner.request(results[0].location)).page.data;
  assert.equal(board.trip.is_demo, true);
  assert.equal(board.trip.name, 'A week away, together');
  assert.equal(board.items.length, 7);
  assert.ok(board.items.every(item => /fictional sample/i.test(item.notes)));
  assert.deepEqual(board.budget, []);
  const before = (await pool.query(`SELECT row_to_json(p) AS member FROM participants p ORDER BY id`)).rows;
  const inviteBefore = (await pool.query('SELECT * FROM trip_invites ORDER BY trip_id')).rows;
  await owner.request(`${results[0].location}/share`);
  await owner.request(results[0].location);
  await owner.request(`${results[0].location}/ideas/new`);
  assert.deepEqual((await pool.query('SELECT row_to_json(p) AS member FROM participants p ORDER BY id')).rows, before);
  assert.deepEqual((await pool.query('SELECT * FROM trip_invites ORDER BY trip_id')).rows, inviteBefore);
  assert.equal((await owner.request('/plans')).page.data.trips.filter(t => t.is_demo).length, 1);
});

test('secure cookies require explicit HTTPS and proxy trust, and env-style session secrets are supported', async () => {
  await close();
  await listen({ cookieSecure: true, trustProxy: true, sessionSecret: 'integration-only-explicit-session-secret' });
  const plain = await browser().request('/login');
  assert.equal(plain.setCookie, null);
  const https = await browser().request('/login', { headers: { 'X-Forwarded-Proto': 'https' } });
  assert.match(https.setCookie, /; Secure/);
  assert.match(https.setCookie, /; HttpOnly/);
  assert.match(https.setCookie, /; SameSite=Lax/);
  await close();
  await listen();
});

test('research collections preserve provenance, enforce subresource ownership, and replace covers', async () => {
  const { owner, alice, bob, path } = await group();
  const item = await idea(alice, path, { url: 'https://example.com/original', source_label: 'Listing', takeaway: 'Initial quote' });
  let detail = (await bob.request(item)).page.data.item;
  assert.equal(detail.source_count, 1);
  assert.equal(detail.sources[0].label, 'Listing');
  assert.equal(detail.sources[0].takeaway, 'Initial quote');
  assert.equal(detail.sources[0].author_name, 'Alice');
  assert.equal(detail.cover_image, null);
  assert.deepEqual(detail.images, []);
  await bob.post(`${item}/vote`);
  await bob.post(`${item}/comments`, { body: 'Keep discussion' });
  assert.equal((await bob.post(`${item}/sources`, { label: 'Review', url: 'http://example.com/review', takeaway: 'Helpful' })).location, `${item}#sources`);
  detail = (await alice.request(item)).page.data.item;
  const source = detail.sources[1];
  assert.equal(source.author_name, 'Bob');
  for (const action of ['edit', 'delete']) assert.equal((await alice.post(`${item}/sources/${source.id}/${action}`, { label: 'No', url: 'https://example.com' })).status, 403);
  assert.equal((await bob.post(`${item}/sources/${source.id}/edit`, { label: 'Updated', url: 'https://example.com/new', takeaway: 'New finding' })).status, 302);
  assert.equal((await alice.post(`${item}/edit`, { title: 'Changed title', kind: 'stay' })).status, 302);
  assert.equal((await alice.request(item)).page.data.item.url, 'https://example.com/original');
  assert.equal((await alice.post(`${item}/edit`, { title: 'Legacy URL edit', kind: 'stay', url: 'https://example.com/legacy-change' })).status, 302);
  detail = (await alice.request(item)).page.data.item;
  assert.equal(detail.sources[0].url, 'https://example.com/original');
  assert.equal(detail.sources[1].url, 'https://example.com/new');
  assert.equal((await bob.post(`${item}/images`, { url: 'https://images.example.com/first.jpg', caption: 'First', source_url: 'http://example.com/credit' })).location, `${item}#photos`);
  assert.equal((await alice.post(`${item}/images`, { url: 'https://images.example.com/second.jpg', caption: 'Second' })).status, 302);
  detail = (await alice.request(item)).page.data.item;
  const [first, second] = detail.images;
  assert.equal(detail.image_count, 2);
  assert.deepEqual(detail.cover_image, { id: first.id, url: first.url, caption: 'First', source_url: 'http://example.com/credit' });
  for (const action of ['edit', 'delete']) assert.equal((await alice.post(`${item}/images/${first.id}/${action}`, { url: first.url })).status, 403);
  assert.equal((await bob.post(`${item}/images/${second.id}/cover`)).status, 403);
  assert.equal((await bob.post(`${item}/images/${first.id}/cover`)).status, 403);
  assert.equal((await alice.post(`${item}/images/${second.id}/cover`)).status, 302);
  assert.equal((await owner.post(`${item}/images/${first.id}/cover`)).status, 302);
  assert.equal((await bob.post(`${item}/images/${first.id}/edit`, { url: first.url, caption: 'Updated caption' })).status, 302);
  assert.equal((await bob.post(`${item}/images/${first.id}/delete`)).status, 302);
  detail = (await bob.request(item)).page.data.item;
  assert.equal(detail.cover_image.id, second.id);
  assert.equal(detail.images[0].is_cover, true);
  assert.equal((await owner.post(`${item}/sources/${source.id}/delete`)).status, 302);
  assert.equal((await owner.post(`${item}/images/${second.id}/delete`)).status, 302);
  detail = (await bob.request(item)).page.data.item;
  assert.equal(detail.cover_image, null);
  assert.equal(detail.vote_count, 1);
  assert.equal(detail.comment_count, 1);
  assert.equal((await owner.post(`${item}/delete`)).status, 302);
  assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM research_sources WHERE item_id=$1', [detail.id])).rows[0].count, 0);
  assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM research_images WHERE item_id=$1', [detail.id])).rows[0].count, 0);
});

test('comparison is read-only, ordered, same-kind and trip-scoped with 2–4 distinct IDs', async () => {
  const { owner, alice, path } = await group();
  const ids = [];
  for (let n = 0; n < 5; n++) ids.push((await idea(owner, path, { kind: 'destination', title: `Candidate ${n}` })).split('/').at(-1));
  const stay = (await idea(owner, path, { kind: 'stay' })).split('/').at(-1);
  await alice.post(`${path}/ideas/${ids[0]}/vote`);
  await alice.post(`${path}/ideas/${ids[0]}/comments`, { body: 'Compare this' });
  await alice.post(`${path}/ideas/${ids[0]}/sources`, { label: 'Guide', url: 'https://example.com/guide' });
  let page = (await alice.request(`${path}/compare`)).page;
  assert.equal(page.view, 'compare');
  assert.equal(page.data.kind, 'destination');
  assert.equal(page.data.candidates.length, 5);
  assert.deepEqual(page.data.items, []);
  page = (await alice.request(`${path}/compare?ids=${ids[1]}&ids=${ids[0]}`)).page;
  assert.deepEqual(page.data.items.map(item => item.id), [Number(ids[1]), Number(ids[0])]);
  assert.equal(page.data.items[1].vote_count, 1);
  assert.equal(page.data.items[1].comment_count, 1);
  assert.equal(page.data.items[1].voted, true);
  assert.equal(page.data.items[1].source_count, 1);
  assert.equal(page.data.items[1].sources[0].label, 'Guide');
  for (const count of [2, 3, 4]) assert.equal((await alice.request(`${path}/compare?ids=${ids.slice(0, count).join(',')}`)).status, 200);
  for (const kind of ['destination', 'stay', 'transport', 'activity', 'link']) assert.equal((await alice.request(`${path}/compare?kind=${kind}`)).status, 200);
  const other = (await owner.post('/plans', { name: 'Foreign comparison' })).location;
  const foreign = (await idea(owner, other, { kind: 'destination' })).split('/').at(-1);
  for (const query of [
    'kind=all', 'kind=bad', 'kind=stay&kind=link', 'ids=', `ids=${ids[0]}`, `ids=${ids.join(',')}`,
    `ids=${ids[0]},${ids[0]}`, `ids=${ids[0]}&ids=${ids[0]}`, `ids=${ids[0]},${stay}`, `ids=${ids[0]},${foreign}`,
    `ids=${ids[0]},2147483648`, `ids=${ids[0]},0`, `ids=${ids[0]},2147483647`, `ids=${ids[0]},1.5`,
    `ids=${ids[0]},`, `ids[x]=${ids[0]}`, `ids=${encodeURIComponent('1 OR 1=1')},${ids[0]}`,
  ]) {
    const invalid = await alice.request(`${path}/compare?${query}`);
    assert.equal(invalid.status, 400, query);
    assert.equal(invalid.page.view, 'error');
  }
  assert.equal((await alice.request(`${other}/compare?ids=${foreign},${ids[0]}`)).status, 404);
  assert.ok((await owner.request(path)).page.data.items.every(item => item.status === 'considering'));
});

test('small comparisons open directly but never change selections or choose a subset', async () => {
  const { owner, alice, path } = await group();
  const ids = [];
  for (let count = 1; count <= 5; count++) {
    ids.push((await idea(owner, path, { kind: 'destination', title: `Choice ${count}` })).split('/').at(-1));
    const result = await alice.request(`${path}/compare`);
    assert.equal(result.status, 200);
    assert.equal(result.page.data.items.length, count >= 2 && count <= 4 ? count : 0);
    if (count >= 2 && count <= 4) {
      assert.deepEqual(result.page.data.items.map(i => i.id), ids.map(Number).reverse());
      assert.ok(result.page.html.includes('class="comparison-table"'));
    }
    assert.equal((await alice.request(path)).page.data.counts.selected, 0);
  }
  const specific = await alice.request(`${path}/compare?ids=${ids[0]},${ids[2]}`);
  assert.deepEqual(specific.page.data.items.map(i => i.id), [Number(ids[0]), Number(ids[2])]);
  assert.equal((await alice.request(`${path}/compare?ids=${ids[0]}`)).status, 400);
});

test('simplified forms keep optional fields accessible and open the matching validation error', async () => {
  const { owner, alice, path } = await group();
  const board = (await owner.request(path)).page.html;
  const navigation = board.match(/<nav class="primary-nav"[\s\S]*?<\/nav>/)[0];
  assert.equal((navigation.match(/class="nav-link/g) || []).length, 3);
  assert.ok(board.includes(`${path}/share`));
  assert.ok(board.includes('id="view-filter"'));
  const editor = (await alice.request(`${path}/ideas/new`)).page.html;
  assert.equal((editor.match(/<details class="editor-disclosure"\s*>/g) || []).length, 3);
  for (const field of ['location','notes','cost','currency','capacity','source_label','takeaway']) {
    assert.ok(editor.includes(`name="${field}"`));
  }
  const item = await idea(alice, path, {});
  const detail = (await alice.request(item)).page.html;
  assert.match(detail, /<details class="add-reference" id="add-source"\s*>/);
  assert.match(detail, /<details class="add-reference" id="add-photo"\s*>/);
  const sourceError = await alice.post(`${item}/sources`, { label: 'Keep this', url: 'javascript:bad', takeaway: 'Keep the note' });
  assert.equal(sourceError.status, 400);
  assert.match(sourceError.page.html, /id="add-source" open>/);
  assert.match(sourceError.page.html, /id="add-photo"\s*>/);
  assert.ok(sourceError.page.html.includes('href="#new-source-url"'));
  assert.match(sourceError.page.html, /id="new-source-url"[^>]*aria-invalid="true"[^>]*aria-describedby="new-source-url-error"/);
  assert.ok(sourceError.page.html.includes('Keep the note'));
  const imageError = await alice.post(`${item}/images`, { url: 'http://example.com/photo.jpg', caption: 'Keep caption' });
  assert.equal(imageError.status, 400);
  assert.match(imageError.page.html, /id="add-photo" open>/);
  assert.match(imageError.page.html, /id="add-source"\s*>/);
  assert.ok(imageError.page.html.includes('href="#new-image-url"'));
  assert.match(imageError.page.html, /id="new-image-url"[^>]*aria-invalid="true"[^>]*aria-describedby="new-image-url-error new-image-hint"/);
  assert.ok(imageError.page.html.includes('id="new-image-url-error" class="field-error"'));
  assert.ok(imageError.page.html.includes('Keep caption'));
});

test('selected plan and board share budgets through shortlist/select/book/deselect/delete and warn without mutating', async () => {
  const { owner, alice, path } = await group();
  const a = await idea(owner, path, { kind: 'destination', title: 'Selected coast', cost: '999' });
  const b = await idea(owner, path, { kind: 'destination', title: 'Other mountains' });
  const stay = await idea(owner, path, { title: 'Coast stay', cost: '100', destination_id: a.split('/').at(-1) });
  const alternate = await idea(owner, path, { title: 'Other stay', cost: '200', currency: 'EUR', destination_id: b.split('/').at(-1) });
  const transport = await idea(owner, path, { kind: 'transport', cost: '50', currency: 'USD' });
  const missing = await idea(owner, path, { kind: 'activity' });
  const link = await idea(owner, path, { kind: 'link', cost: '5000' });
  async function check(budget, unknown, selected) {
    const board = (await alice.request(path)).page.data;
    const result = await alice.request(`${path}/selected`);
    assert.equal(result.status, 200, result.text);
    assert.equal(result.page.view, 'selected');
    const plan = result.page.data;
    assert.deepEqual(board.budget, budget);
    assert.deepEqual(plan.budget, budget);
    assert.equal(board.missingCosts, unknown);
    assert.equal(plan.missingCosts, unknown);
    assert.equal(board.counts.selected, selected);
    assert.equal(plan.items.length, selected);
    assert.ok(plan.items.every(item => ['selected', 'booked'].includes(item.status)));
    return plan;
  }
  for (const item of [stay, alternate, missing]) await owner.post(`${item}/status`, { status: 'shortlisted' });
  await check([], 0, 0);
  assert.equal((await alice.request(`${path}?view=shortlisted`)).page.data.items.length, 3);
  for (const item of [a, stay, alternate, missing, link]) await owner.post(`${item}/status`, { status: 'selected' });
  await owner.post(`${transport}/status`, { status: 'booked' });
  let plan = await check([{ currency: 'CAD', total: '100.00' }, { currency: 'EUR', total: '200.00' }, { currency: 'USD', total: '50.00' }], 1, 6);
  assert.ok((await alice.request(path)).page.html.includes('Selected coast selected'));
  assert.ok(plan.selectionWarnings.some(message => message.includes('Other mountains')));
  assert.ok(plan.selectionWarnings.some(message => /multiple.*stay/i.test(message)));
  const returned = await owner.post(`${alternate}/status`, { status: 'shortlisted', returnTo: 'selected' });
  assert.equal(returned.location, `${path}/selected`);
  await owner.post(`${transport}/status`, { status: 'eliminated' });
  await check([{ currency: 'CAD', total: '100.00' }], 1, 4);
  await owner.post(`${stay}/status`, { status: 'considering' });
  await check([], 1, 3);
  await owner.post(`${missing}/edit`, { kind: 'activity', title: 'Now quoted', cost: '0', currency: 'GBP' });
  await check([{ currency: 'GBP', total: '0.00' }], 0, 3);
  await owner.post(`${missing}/delete`);
  plan = await check([], 0, 2);
  assert.deepEqual(plan.selectionWarnings, []);
  assert.equal((await alice.post(`${link}/status`, { status: 'selected' })).status, 403);
});

test('reference validation preserves attempted metadata, rejects unsafe URLs, and never partially creates an idea', async () => {
  const { alice, path } = await group();
  const item = await idea(alice, path, {});
  for (const url of ['', 'javascript:alert(1)', 'data:text/html,test', 'ftp://example.com', 'https://u:p@example.com',
    'https://@example.com', '/relative', 'https:example.com', 'https://example.com/white space', ' https://example.com/',
    'https://example.com/\tpath', 'https://example.com/\\path', 'https://example.com/\u00a0path', 'https://example.com/' + 'x'.repeat(2048)]) {
    const response = await alice.post(`${item}/sources`, { label: 'Preserved label', url, takeaway: 'Preserved takeaway' });
    assert.equal(response.status, 400, url);
    assert.equal(response.page.view, 'idea');
    assert.equal(response.page.data.sourceValues.url, url);
    assert.equal(response.page.data.sourceValues.label, 'Preserved label');
    assert.equal(response.page.data.sourceValues.takeaway, 'Preserved takeaway');
    assert.deepEqual(response.page.data.item.sources, []);
    assert.deepEqual(response.page.data.comments, []);
    assert.equal(response.page.data.canEdit, true);
    assert.deepEqual(response.page.data.destinations, []);
  }
  for (const url of ['', 'http://images.example.com/a.jpg', 'data:image/png;base64,a', 'javascript:alert(1)',
    'https://u:p@example.com/a.jpg', 'https://example.com/white space', 'https://example.com/\\path',
    'https://localhost/a', 'https://LOCALHOST./a', 'https://x.localhost/a', 'https://printer.local/a', 'https://intranet/a',
    'https://0.0.0.0/a', 'https://127.0.0.1/a', 'https://127.1/a', 'https://2130706433/a', 'https://0x7f000001/a',
    'https://10.0.0.1/a', 'https://172.16.0.1/a', 'https://172.31.255.255/a', 'https://192.168.1.1/a',
    'https://169.254.169.254/a', 'https://100.64.0.1/a', 'https://[::]/a', 'https://[::1]/a',
    'https://[::ffff:127.0.0.1]/a', 'https://[fc00::1]/a', 'https://[fe80::1]/a']) {
    const response = await alice.post(`${item}/images`, { url, caption: 'Preserved caption', source_url: 'https://example.com/credit' });
    assert.equal(response.status, 400, url);
    assert.equal(response.page.view, 'idea');
    assert.equal(response.page.data.imageValues.url, url);
    assert.equal(response.page.data.imageValues.caption, 'Preserved caption');
    assert.equal(response.page.data.imageValues.source_url, 'https://example.com/credit');
    assert.equal(response.page.data.item.image_count, 0);
  }
  for (const body of [{ label: '' }, { label: 'x'.repeat(121) }, { takeaway: 'x'.repeat(2001) }]) {
    assert.equal((await alice.post(`${item}/sources`, { label: 'Valid', url: 'https://example.com', ...body })).status, 400);
  }
  for (const body of [{ caption: 'x'.repeat(301) }, { source_url: 'javascript:alert(1)' }, { source_url: 'https://u:p@example.com' }]) {
    assert.equal((await alice.post(`${item}/images`, { url: 'https://example.com/image.jpg', ...body })).status, 400);
  }
  const before = (await alice.request(path)).page.data.counts.all;
  const incomplete = await alice.post(`${path}/ideas`, { kind: 'destination', title: 'Keep my research', source_label: 'A useful guide', takeaway: 'Important context' });
  assert.equal(incomplete.status, 400);
  assert.equal(incomplete.page.data.values.takeaway, 'Important context');
  for (const body of [{ source_label: 'x'.repeat(121) }, { takeaway: 'x'.repeat(2001) }]) {
    const response = await alice.post(`${path}/ideas`, { kind: 'link', title: 'Do not partially insert', url: 'https://example.com', ...body });
    assert.equal(response.status, 400);
  }
  assert.equal((await alice.request(path)).page.data.counts.all, before);
  const label = '<script>alert("source")</script>', takeaway = '<img src=x onerror=alert(1)>', caption = '<script>alert("caption")</script>';
  assert.equal((await alice.post(`${item}/sources`, { label, url: 'https://example.com', takeaway })).status, 302);
  assert.equal((await alice.post(`${item}/images`, { url: 'https://example.com/image.jpg', caption })).status, 302);
  const result = await alice.request(item);
  assert.equal(result.page.data.item.sources[0].label, label);
  assert.equal(result.page.data.item.sources[0].takeaway, takeaway);
  assert.equal(result.page.data.item.images[0].caption, caption);
  assert.ok(!result.page.html.includes(label));
  assert.ok(!result.page.html.includes(takeaway));
  assert.ok(!result.page.html.includes(caption));
  const sourceId = result.page.data.item.sources[0].id, imageId = result.page.data.item.images[0].id;
  const badSourceEdit = await alice.post(`${item}/sources/${sourceId}/edit`, { label: 'Keep edit', url: 'javascript:alert(1)', takeaway });
  assert.equal(badSourceEdit.status, 400);
  assert.equal(badSourceEdit.page.data.sourceValues.id, String(sourceId));
  assert.equal(badSourceEdit.page.data.referenceAction, 'edit');
  assert.equal(badSourceEdit.page.data.errorTarget, `source-${sourceId}-url`);
  assert.equal(badSourceEdit.page.data.item.sources[0].label, label);
  const badImageEdit = await alice.post(`${item}/images/${imageId}/edit`, { url: 'http://example.com/a', caption });
  assert.equal(badImageEdit.status, 400);
  assert.equal(badImageEdit.page.data.imageValues.id, String(imageId));
  assert.equal(badImageEdit.page.data.errorTarget, `image-${imageId}-url`);
  assert.equal(badImageEdit.page.data.item.cover_image.id, imageId);
});

test('source/image metadata is escaped by real collection EJS', async () => {
  const { alice, path } = await group();
  const item = await idea(alice, path, {});
  const label = '<script>alert("source")</script>', takeaway = '<img src=x onerror=alert(1)>', caption = '<script>alert("caption")</script>';
  await alice.post(`${item}/sources`, { label, url: 'https://example.com/?one=1&two=2', takeaway });
  await alice.post(`${item}/images`, { url: 'https://example.com/image.jpg', caption, source_url: 'https://example.com/?credit=1&two=2' });
  const result = await alice.request(item);
  assert.equal(result.status, 200);
  assert.ok(result.page.html.includes(`/sources/${result.page.data.item.sources[0].id}/`));
  const { escapeXML } = require('ejs');
  for (const value of [label, takeaway, caption, 'https://example.com/?one=1&two=2', 'https://example.com/?credit=1&two=2']) {
    assert.ok(!result.page.html.includes(value));
    assert.ok(result.page.html.includes(escapeXML(value)));
  }
});

test('reference IDs are scoped to their parent idea/trip, guest membership is required, and CSRF protects every action', async () => {
  const { owner, alice, bob, path } = await group();
  const first = await idea(alice, path, {}), second = await idea(bob, path, {});
  const other = (await owner.post('/plans', { name: 'Foreign references' })).location;
  const foreign = await idea(owner, other, {});
  for (const item of [second, foreign]) {
    await owner.post(`${item}/sources`, { label: 'Protected', url: 'https://example.com' });
    await owner.post(`${item}/images`, { url: 'https://example.com/image.jpg' });
    const detail = (await owner.request(item)).page.data.item;
    for (const action of ['edit', 'delete']) {
      assert.equal((await owner.post(`${first}/sources/${detail.sources[0].id}/${action}`, { label: 'No', url: 'https://example.com' })).status, 404);
      assert.equal((await owner.post(`${first}/images/${detail.images[0].id}/${action}`, { url: 'https://example.com' })).status, 404);
    }
    assert.equal((await owner.post(`${first}/images/${detail.images[0].id}/cover`)).status, 404);
  }
  const foreignId = foreign.split('/').at(-1);
  for (const suffix of ['/sources', '/images', '/sources/1/edit', '/sources/1/delete', '/images/1/edit', '/images/1/delete', '/images/1/cover']) {
    assert.equal((await alice.post(`${path}/ideas/${foreignId}${suffix}`, { label: 'No', url: 'https://example.com' })).status, 404);
    assert.equal((await alice.post(`${first}${suffix}`, { label: 'No', url: 'https://example.com' }, { token: false })).status, 403);
    assert.equal((await alice.post(`${first}${suffix}`, { label: 'No', url: 'https://example.com' }, { headers: { Origin: 'https://attacker.example' } })).status, 403);
  }
  assert.equal((await alice.post(`${foreign}/sources`, { label: 'No', url: 'https://example.com' })).status, 404);
  assert.equal((await alice.post(`${foreign}/images`, { url: 'https://example.com' })).status, 404);
  const aliceMember = (await owner.request(`${path}/share`)).page.data.members.find(member => member.name === 'Alice');
  await owner.post(`${path}/members/${aliceMember.id}/remove`);
  for (const suffix of ['/sources', '/images', '/images/1/cover']) assert.equal((await alice.post(`${first}${suffix}`, { label: 'No', url: 'https://example.com' })).status, 403);
  assert.equal((await bob.request(`${path}/selected`)).status, 200);
});

test('collection limits hold under concurrent requests and cover replacement is oldest-first', async () => {
  const { owner, alice, bob, path } = await group();
  const concurrentItem = await idea(owner, path, {});
  const firstImages = await Promise.all([alice, bob].map(person => person.post(`${concurrentItem}/images`, { url: 'https://example.com/concurrent.jpg' })));
  assert.ok(firstImages.every(response => response.status === 302));
  const firstDetail = (await owner.request(concurrentItem)).page.data.item;
  assert.equal(firstDetail.images.filter(image => image.is_cover).length, 1);
  assert.equal(firstDetail.cover_image.id, firstDetail.images[0].id);
  await assert.rejects(pool.query('UPDATE research_images SET is_cover=TRUE WHERE id=$1', [firstDetail.images[1].id]), /unique constraint/);
  const item = await idea(owner, path, {});
  for (let n = 0; n < 19; n++) assert.equal((await alice.post(`${item}/sources`, { label: `Source ${n}`, url: 'https://example.com' })).status, 302);
  const sources = await Promise.all([alice, bob].map(person => person.post(`${item}/sources`, { label: 'Last slot', url: 'https://example.com' })));
  assert.deepEqual(sources.map(response => response.status).sort(), [302, 400]);
  for (let n = 0; n < 11; n++) assert.equal((await alice.post(`${item}/images`, { url: `https://example.com/${n}.jpg` })).status, 302);
  const images = await Promise.all([alice, bob].map(person => person.post(`${item}/images`, { url: 'https://example.com/last.jpg' })));
  assert.deepEqual(images.map(response => response.status).sort(), [302, 400]);
  let detail = (await owner.request(item)).page.data.item;
  assert.equal(detail.source_count, 20);
  assert.equal(detail.image_count, 12);
  assert.equal(detail.images.filter(image => image.is_cover).length, 1);
  assert.equal((await owner.post(`${item}/sources/${detail.sources[0].id}/edit`, { label: 'Editable at limit', url: 'https://example.com/new' })).status, 302);
  assert.equal((await owner.post(`${item}/images/${detail.images[0].id}/edit`, { url: 'https://example.com/new.jpg' })).status, 302);
  const oldest = detail.images[0].id, last = detail.images.at(-1).id;
  await Promise.all([owner.post(`${item}/images/${last}/cover`), owner.post(`${item}/images/${detail.images[4].id}/cover`)]);
  detail = (await owner.request(item)).page.data.item;
  assert.equal(detail.images.filter(image => image.is_cover).length, 1);
  assert.equal((await owner.post(`${item}/images/${detail.cover_image.id}/delete`)).status, 302);
  detail = (await owner.request(item)).page.data.item;
  assert.equal(detail.cover_image.id, oldest);
  await owner.post(`${item}/images/${oldest}/delete`);
  detail = (await owner.request(item)).page.data.item;
  assert.equal(detail.cover_image.id, detail.images[0].id);
  // Leave live collection rows in place to exercise FK cascades, including a cover.
  await owner.post(`${item}/delete`);
  for (const table of ['research_sources', 'research_images']) assert.equal((await pool.query(`SELECT COUNT(*)::int AS count FROM ${table} WHERE item_id=$1`, [detail.id])).rows[0].count, 0);
});

test('login and invite join attempts are bounded in PostgreSQL, including after a restart', async () => {
  const attacker = browser();
  await attacker.request('/login');
  let response;
  for (let n = 0; n < 11; n++) response = await attacker.post('/login', { username: 'wrong', password: 'wrong' });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '900');
  const activeInvite = '/join/' + (await pool.query('SELECT secret_token FROM trip_invites ORDER BY trip_id LIMIT 1')).rows[0].secret_token;
  await attacker.request(activeInvite);
  for (let n = 0; n < 31; n++) response = await attacker.post(activeInvite, { name: '' });
  assert.equal(response.status, 429);
  await close();
  await listen();
  assert.equal((await attacker.post('/login', { username: 'wrong', password: 'wrong' })).status, 429);
  assert.equal((await attacker.post(activeInvite, { name: 'New attempt' })).status, 429);
});