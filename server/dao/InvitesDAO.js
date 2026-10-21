class InvitesDAO {
  constructor(db) { this.db = db; }

  async findToken(tripId) {
    const r = await this.db.query('SELECT secret_token FROM trip_invites WHERE trip_id = $1', [tripId]);
    return r.rows[0]?.secret_token;
  }

  async findTripByHash(tokenHash) {
    const r = await this.db.query(`SELECT t.id, t.name, t.is_demo, t.owner_id
      FROM trips t JOIN trip_invites i ON i.trip_id = t.id WHERE i.token_hash = $1`, [tokenHash]);
    return r.rows[0];
  }

  async replace(tripId, tokenHash, token) {
    await this.db.query(`INSERT INTO trip_invites (trip_id, token_hash, secret_token) VALUES ($1, $2, $3)
      ON CONFLICT (trip_id) DO UPDATE SET token_hash = EXCLUDED.token_hash, secret_token = EXCLUDED.secret_token, created_at = NOW()`,
    [tripId, tokenHash, token]);
  }
}

module.exports = InvitesDAO;
