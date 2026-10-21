class UsersDAO {
  constructor(db) { this.db = db; }

  async find(id) {
    const r = await this.db.query('SELECT id, username FROM users WHERE id = $1', [id]);
    return r.rows[0];
  }

  async findByUsername(username) {
    const r = await this.db.query('SELECT * FROM users WHERE username = $1', [username]);
    return r.rows[0];
  }

  async count() {
    const r = await this.db.query('SELECT COUNT(*)::int AS count FROM users');
    return r.rows[0].count;
  }

  // Creates the account, or resets its password if the username exists.
  async upsert(username, passwordHash) {
    const r = await this.db.query(`INSERT INTO users (username, password_hash) VALUES ($1, $2)
      ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash
      RETURNING id, username, (xmax = 0) AS inserted`, [username, passwordHash]);
    return r.rows[0];
  }

  async countUnownedTrips() {
    const r = await this.db.query('SELECT COUNT(*)::int AS count FROM trips WHERE owner_id IS NULL');
    return r.rows[0].count;
  }

  // Gives trips from before accounts existed to this user, and names their organizer after it.
  async claimUnownedTrips(userId, username) {
    const r = await this.db.query('UPDATE trips SET owner_id = $1 WHERE owner_id IS NULL RETURNING id', [userId]);
    await this.db.query('UPDATE participants SET name = $2 WHERE is_organizer AND trip_id = ANY($1::int[])', [r.rows.map(row => row.id), username]);
    return r.rows.length;
  }
}

module.exports = UsersDAO;
