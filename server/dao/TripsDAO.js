class TripsDAO {
  constructor(pool) { this.pool = pool; }

  async getAll() {
    const r = await this.pool.query(
      `SELECT t.*,
              COUNT(h.id)::int            AS hotel_count,
              COUNT(CASE WHEN h.status='booked'      THEN 1 END)::int AS booked_count,
              COUNT(CASE WHEN h.status='considering' THEN 1 END)::int AS considering_count
       FROM trips t
       LEFT JOIN hotels h ON h.trip_id = t.id
       GROUP BY t.id
       ORDER BY t.created_at DESC`
    );
    return r.rows;
  }

  async getById(id) {
    const r = await this.pool.query('SELECT * FROM trips WHERE id=$1', [id]);
    return r.rows[0];
  }

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

  async update(id, { name, destination, travel_start, travel_end }) {
    const r = await this.pool.query(
      `UPDATE trips SET name=$1, destination=$2, travel_start=$3, travel_end=$4
       WHERE id=$5 RETURNING *`,
      [name, destination || null, travel_start || null, travel_end || null, id]
    );
    return r.rows[0];
  }

  async delete(id) {
    await this.pool.query('DELETE FROM trips WHERE id=$1', [id]);
  }
}

module.exports = TripsDAO;
