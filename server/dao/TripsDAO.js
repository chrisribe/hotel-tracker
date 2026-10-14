class TripsDAO {
  constructor(pool) { this.pool = pool; }

  async create({ name, description, destination, travel_start, travel_end }) {
    const r = await this.pool.query(
      `INSERT INTO trips (name, description, destination, travel_start, travel_end)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [name, description ?? null, destination || null, travel_start || null, travel_end || null]
    );
    return r.rows[0];
  }

  // Organizers see every plan; guests only the one they joined.
  async listForViewer(isOrganizer, tripId) {
    const r = await this.pool.query(
      `SELECT t.*,
              (SELECT COUNT(*)::int FROM research_items i WHERE i.trip_id = t.id) AS item_count,
              (SELECT COUNT(*)::int FROM participants p WHERE p.trip_id = t.id AND p.active) AS member_count
       FROM trips t
       WHERE $1::boolean OR t.id = $2
       ORDER BY t.created_at DESC, t.id DESC`,
      [isOrganizer, tripId]
    );
    return r.rows;
  }

  async lock(id) {
    const r = await this.pool.query('SELECT * FROM trips WHERE id=$1 FOR UPDATE', [id]);
    return r.rows[0];
  }

  async findDemo() {
    const r = await this.pool.query('SELECT * FROM trips WHERE is_demo');
    return r.rows[0];
  }

  async createDemo(name, description) {
    const r = await this.pool.query('INSERT INTO trips (name, description, is_demo) VALUES ($1,$2,TRUE) RETURNING *', [name, description]);
    return r.rows[0];
  }

  // Held until the transaction ends so concurrent requests create only one demo per schema.
  async lockDemo() {
    await this.pool.query("SELECT pg_advisory_xact_lock(hashtext(current_schema()), hashtext('hotel-tracker-demo'))");
  }

}

module.exports = TripsDAO;
