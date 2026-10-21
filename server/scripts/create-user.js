#!/usr/bin/env node
// Creates an organizer account, or resets its password. There is no public sign-up.
//   npm run create-user -- <username>
//   docker compose exec server npm run create-user -- <username>
require('dotenv').config();
const readline = require('node:readline');
const { Pool } = require('pg');
const { migrate } = require('./init-db');
const { hashPassword } = require('../middleware/planner-auth');
const UsersDAO = require('../dao/UsersDAO');

const USERNAME = /^[a-z0-9_.-]{3,40}$/;

function ask(question, hidden = false) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  // Hides the password while it is typed.
  if (hidden) rl._writeToOutput = text => { if (text.startsWith(question)) rl.output.write(question); };
  return new Promise(resolve => rl.question(question, answer => {
    rl.close();
    if (hidden) process.stdout.write('\n');
    resolve(answer);
  }));
}

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const username = (process.argv[2] || await ask('Username: ')).trim().toLowerCase();
    if (!USERNAME.test(username)) throw new Error('Username must be 3-40 characters: a-z, 0-9, _ . -');
    const password = await ask('Password (min 12 chars): ', true);
    if (password.length < 12 || password.length > 1024) throw new Error('Password must be 12 to 1024 characters.');
    if (password !== await ask('Repeat password: ', true)) throw new Error('Passwords do not match.');

    await migrate(pool);
    const users = new UsersDAO(pool);
    const user = await users.upsert(username, await hashPassword(password));
    console.log(user.inserted ? `Account '${username}' created.` : `Password for '${username}' reset.`);

    // Trips from before accounts existed belong to nobody until someone claims them.
    const unowned = await users.countUnownedTrips();
    if (unowned && /^y/i.test(await ask(`Give the ${unowned} trip(s) without an organizer account to '${username}'? [y/N] `))) {
      console.log(`${await users.claimUnownedTrips(user.id, username)} trip(s) now organized by '${username}'.`);
    }
  } catch (error) {
    console.error('Error:', error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
