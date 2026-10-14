class AttemptsDAO {
  constructor(db) { this.db = db; }

  async increment(key) {
    await this.db.query('DELETE FROM planner_attempts WHERE expires_at <= NOW()');
    const r = await this.db.query(`INSERT INTO planner_attempts (key, attempts, expires_at) VALUES ($1, 1, NOW() + INTERVAL '15 minutes')
      ON CONFLICT (key) DO UPDATE SET attempts = planner_attempts.attempts + 1 RETURNING attempts`, [key]);
    return r.rows[0].attempts;
  }
}

module.exports = AttemptsDAO;
