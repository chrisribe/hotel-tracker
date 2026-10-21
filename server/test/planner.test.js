const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { Pool } = require('pg');
const { createApp } = require('../app');
const { hashPassword } = require('../middleware/planner-auth');
const UsersDAO = require('../dao/UsersDAO');

// Only this random schema is created and dropped, never the application's schema.
const schemaName = `planner_test_${randomBytes(8).toString('hex')}`;
const connectionString = process.env.TEST_DATABASE_URL || 'postgresql://hotel:hotelpass@localhost:5432/hotel_tracker';
const account = { username: 'test-organizer', password: 'test-password-123' };
const otherAccount = { username: 'other-organizer', password: 'another-password-456' };
let adminPool, pool, app, server, base;

before(async () => {
  adminPool = new Pool({ connectionString });
  await adminPool.query(`CREATE SCHEMA ${schemaName}`);
  pool = new Pool({ connectionString, options: `-c search_path=${schemaName}` });
  app = await createApp({ pool, config: { cookieSecure: false, agentToken: '', discordWebhook: '', discordMention: '' } });

  // Still render real EJS, but return its page data for straightforward assertions.
  const render = app.render.bind(app);
  app.render = (view, locals, callback) => render(view, locals, error =>
    callback(error, error ? undefined : JSON.stringify(locals)));
  server = await new Promise(resolve => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  base = `http://127.0.0.1:${server.address().port}`;

  const users = new UsersDAO(pool);
  for (const { username, password } of [account, otherAccount]) {
    await users.upsert(username, await hashPassword(password));
  }
});

beforeEach(async () => {
  await pool.query('DELETE FROM planner_attempts');
});

after(async () => {
  try {
    if (server) await new Promise(resolve => server.close(resolve));
  } finally {
    app?.get('sessionStore').close();
    await pool?.end();
    if (adminPool) {
      try {
        await adminPool.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
      } finally {
        await adminPool.end();
      }
    }
  }
});

function browser() {
  let cookie = '', csrf = '';
  return {
    async request(path, body, includeCsrf = true) {
      const options = { redirect: 'manual', headers: { Cookie: cookie } };
      if (body !== undefined) {
        options.method = 'POST';
        options.body = new URLSearchParams({ ...(includeCsrf ? { _csrf: csrf } : {}), ...body });
      }
      const response = await fetch(`${base}${path}`, options);
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      const text = await response.text();
      let page;
      try { page = JSON.parse(text); } catch { /* Redirects and plain-text errors. */ }
      if (page?.csrfToken) csrf = page.csrfToken;
      return { status: response.status, location: response.headers.get('location'), page };
    },
    async post(path, body = {}, includeCsrf = true) {
      return this.request(path, body, includeCsrf);
    },
    async login(credentials = account) {
      await this.request('/login');
      const response = await this.post('/login', credentials);
      await this.request('/plans'); // Login rotates the session and CSRF token.
      return response;
    },
  };
}

async function createTrip() {
  const owner = browser();
  await owner.login();
  const response = await owner.post('/plans', { name: 'Beach week', currency: 'CAD' });
  assert.equal(response.status, 302);
  return { owner, path: response.location };
}

async function joinGuest(owner, path) {
  const guest = browser();
  const { page } = await owner.request(`${path}/share`);
  await guest.request(page.data.invitePath);
  const response = await guest.post(page.data.invitePath, { name: 'Alice' });
  assert.equal(response.location, path);
  await guest.request(path); // Joining rotates the session and CSRF token too.
  return guest;
}

test('login opens the account session', async () => {
  const visitor = browser();

  const response = await visitor.login();

  assert.equal(response.location, '/plans');
  assert.equal((await visitor.request('/plans')).page.viewer.name, account.username);
});

test('invalid login does not authenticate', async () => {
  const visitor = browser();
  await visitor.request('/login');

  const response = await visitor.post('/login', { ...account, password: 'wrong-password' });

  assert.equal(response.status, 400);
  assert.equal((await visitor.request('/plans')).location, '/login');
});

test('logout ends the session', async () => {
  const visitor = browser();
  await visitor.login();

  const response = await visitor.post('/logout');

  assert.equal(response.location, '/login');
  assert.equal((await visitor.request('/plans')).location, '/login');
});

test('create trip saves its name and currency', async () => {
  const owner = browser();
  await owner.login();

  const response = await owner.post('/plans', { name: 'Lisbon in May', currency: 'EUR' });

  assert.equal(response.status, 302);
  const { trip } = (await owner.request(response.location)).page.data;
  assert.equal(trip.name, 'Lisbon in May');
  assert.equal(trip.currency, 'EUR');
});

test('a guest can add an idea', async () => {
  const { owner, path } = await createTrip();
  const guest = await joinGuest(owner, path);

  const response = await guest.post(`${path}/ideas`, { kind: 'stay', title: 'Hotel Sol' });

  assert.equal(response.status, 302);
  const { item } = (await guest.request(response.location)).page.data;
  assert.equal(item.title, 'Hotel Sol');
  assert.equal(item.author_name, 'Alice');
});

test('a guest can edit an open idea', async () => {
  const { owner, path } = await createTrip();
  const guest = await joinGuest(owner, path);
  const item = (await owner.post(`${path}/ideas`, { kind: 'stay', title: 'Original' })).location;

  const response = await guest.post(`${item}/edit`, { kind: 'stay', title: 'Corrected' });

  assert.equal(response.location, item);
  const saved = (await owner.request(item)).page.data.item;
  assert.equal(saved.title, 'Corrected');
  assert.equal(saved.editor_name, 'Alice');
});

test('an organizer can delete an idea', async () => {
  const { owner, path } = await createTrip();
  const item = (await owner.post(`${path}/ideas`, { kind: 'stay', title: 'Remove me' })).location;

  const response = await owner.post(`${item}/delete`);

  assert.equal(response.location, path);
  assert.equal((await owner.request(item)).status, 404);
});

test('joining an invite grants guest access', async () => {
  const { owner, path } = await createTrip();
  const guest = browser();
  const invite = (await owner.request(`${path}/share`)).page.data.invitePath;
  await guest.request(invite);

  const response = await guest.post(invite, { name: 'Alice' });

  assert.equal(response.location, path);
  const { viewer } = (await guest.request(path)).page;
  assert.equal(viewer.name, 'Alice');
  assert.equal(viewer.isOrganizer, false);
});

test('revoking membership removes guest access', async () => {
  const { owner, path } = await createTrip();
  const guest = await joinGuest(owner, path);
  const members = (await owner.request(`${path}/share`)).page.data.members;
  const member = members.find(person => person.name === 'Alice');

  const response = await owner.post(`${path}/members/${member.id}/remove`);

  assert.equal(response.status, 302);
  assert.equal((await guest.request(path)).status, 403);
});

test('a guest cannot edit organizer-only trip settings', async () => {
  const { owner, path } = await createTrip();
  const guest = await joinGuest(owner, path);

  const response = await guest.post(`${path}/edit`, { name: 'Hijacked' });

  assert.equal(response.status, 403);
  assert.equal((await owner.request(path)).page.data.trip.name, 'Beach week');
});

test('an organizer can delete a trip from settings', async () => {
  const { owner, path } = await createTrip();
  await owner.post(`${path}/ideas`, { kind: 'stay', title: 'Will be deleted' });

  const response = await owner.post(`${path}/delete`);

  assert.equal(response.location, '/plans');
  assert.equal((await owner.request(path)).status, 404);
  assert.equal((await owner.request('/plans')).page.data.trips.some(t => `/plans/${t.id}` === path), false);
});

test('a guest cannot delete the trip', async () => {
  const { owner, path } = await createTrip();
  const guest = await joinGuest(owner, path);

  const response = await guest.post(`${path}/delete`);

  assert.equal(response.status, 403);
  assert.equal((await owner.request(path)).status, 200);
});

test('another account cannot access a private trip', async () => {
  const { path } = await createTrip();
  const outsider = browser();
  await outsider.login(otherAccount);

  const response = await outsider.request(path);

  assert.equal(response.status, 404);
});

test('selecting an expense adds it to the selected budget', async () => {
  const { owner, path } = await createTrip();
  const item = (await owner.post(`${path}/ideas`, { kind: 'stay', title: 'Hotel', cost: '125', currency: 'CAD' })).location;

  const response = await owner.post(`${item}/status`, { status: 'selected' });

  assert.equal(response.status, 302);
  const selected = (await owner.request(`${path}/selected`)).page.data;
  assert.deepEqual(selected.items.map(idea => idea.title), ['Hotel']);
  assert.deepEqual(selected.budget, [{ currency: 'CAD', total: '125.00' }]);
});

test('a guest can request Butler research', async () => {
  const { owner, path } = await createTrip();
  const guest = await joinGuest(owner, path);

  const response = await guest.post(`${path}/question`, { question: 'Find flights from Toronto' });

  assert.equal(response.location, `${path}#butler`);
  const { trip } = (await owner.request(path)).page.data;
  assert.equal(trip.butler_question, 'Find flights from Toronto');
  assert.ok(trip.generation_requested_at);
});

test('an organizer can cancel Butler research', async () => {
  const { owner, path } = await createTrip();
  await owner.post(`${path}/question`, { question: 'Find a beach hotel' });
  assert.ok((await owner.request(path)).page.data.trip.generation_requested_at);

  const response = await owner.post(`${path}/question/cancel`);

  assert.equal(response.location, `${path}#butler`);
  assert.equal((await owner.request(path)).page.data.trip.generation_requested_at, null);
});

test('idea writes require a CSRF token', async () => {
  const { owner, path } = await createTrip();

  const response = await owner.post(`${path}/ideas`, { kind: 'stay', title: 'No token' }, false);

  assert.equal(response.status, 403);
});

test('idea validation rejects an unsafe reference URL', async () => {
  const { owner, path } = await createTrip();

  const response = await owner.post(`${path}/ideas`, { kind: 'link', title: 'Unsafe', url: 'javascript:alert(1)' });

  assert.equal(response.status, 400);
});