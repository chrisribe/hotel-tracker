class TripsDAO {
  constructor(pool) { this.pool = pool; }

  async getAll() {
    const r = await this.pool.query(
      `SELECT t.*,
              COUNT(h.id)::int            AS hotel_count,
              COUNT(CASE WHEN h.status='booked' THEN 1 END)::int AS booked_count
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

  async create({ name, destination, travel_start, travel_end }) {
    const r = await this.pool.query(
      `INSERT INTO trips (name, destination, travel_start, travel_end)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [name, destination || null, travel_start || null, travel_end || null]
    );
    return r.rows[0];
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
