class ParticipantsDAO {
  constructor(db) { this.db = db; }

  async find(tripId, id) {
    const r = await this.db.query('SELECT * FROM participants WHERE id = $1 AND trip_id = $2', [id, tripId]);
    return r.rows[0];
  }

  async findActive(tripId, id) {
    const r = await this.db.query('SELECT * FROM participants WHERE id = $1 AND trip_id = $2 AND active', [id, tripId]);
    return r.rows[0];
  }

  async findOrganizer(tripId) {
    const r = await this.db.query('SELECT * FROM participants WHERE trip_id = $1 AND is_organizer AND active', [tripId]);
    return r.rows[0];
  }

  async listActive(tripId) {
    const r = await this.db.query('SELECT id, name, is_organizer, origin FROM participants WHERE trip_id = $1 AND active ORDER BY is_organizer DESC, id', [tripId]);
    return r.rows;
  }

  async create(tripId, name) {
    const r = await this.db.query('INSERT INTO participants (trip_id, name) VALUES ($1, $2) RETURNING *', [tripId, name]);
    return r.rows[0];
  }

  async upsertOrganizer(tripId, name) {
    const r = await this.db.query(`INSERT INTO participants (trip_id, name, is_organizer) VALUES ($1, $2, TRUE)
      ON CONFLICT (trip_id) WHERE is_organizer DO UPDATE SET active = TRUE, name = EXCLUDED.name RETURNING *`,
    [tripId, (name || 'Organizer').slice(0, 80)]);
    return r.rows[0];
  }

  async setOrigin(tripId, id, origin) {
    const r = await this.db.query('UPDATE participants SET origin = $1 WHERE id = $2 AND trip_id = $3 AND active RETURNING id, name, is_organizer, origin',
      [origin, id, tripId]);
    return r.rows[0];
  }

  async deactivate(tripId, id) {
    await this.db.query('UPDATE participants SET active = FALSE WHERE id = $1 AND trip_id = $2', [id, tripId]);
  }
}

module.exports = ParticipantsDAO;
