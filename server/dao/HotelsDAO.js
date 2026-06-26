class HotelsDAO {
  constructor(pool) { this.pool = pool; }

  async getByTrip(tripId) {
    const r = await this.pool.query(
      `SELECT h.*,
              COALESCE(json_agg(l ORDER BY l.added_at) FILTER (WHERE l.id IS NOT NULL), '[]') AS links
       FROM hotels h
       LEFT JOIN hotel_links l ON l.hotel_id = h.id
       WHERE h.trip_id = $1
       GROUP BY h.id
       ORDER BY h.sort_order, h.created_at`,
      [tripId]
    );
    return r.rows;
  }

  async getById(id) {
    const r = await this.pool.query(
      `SELECT h.*,
              COALESCE(json_agg(l ORDER BY l.added_at) FILTER (WHERE l.id IS NOT NULL), '[]') AS links
       FROM hotels h
       LEFT JOIN hotel_links l ON l.hotel_id = h.id
       WHERE h.id = $1
       GROUP BY h.id`,
      [id]
    );
    return r.rows[0];
  }

  async create({ trip_id, name, destination, price_display, status }) {
    const r = await this.pool.query(
      `INSERT INTO hotels (trip_id, name, destination, price_display, status)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [trip_id, name, destination || null, price_display || null, status || 'considering']
    );
    return r.rows[0];
  }

  async patch(id, fields) {
    // Whitelist of patchable columns
    const allowed = [
      'name','destination','price_display','price_min','price_max','price_currency',
      'status','notes','thumbnail_url','description',
      'rating_beach','rating_property','rating_food','rating_pools','rating_location','rating_value',
      'pros','cons','sort_order',
    ];
    const keys = Object.keys(fields).filter(k => allowed.includes(k));
    if (!keys.length) return this.getById(id);
    const sets = keys.map((k, i) => `${k}=$${i + 1}`).join(', ');
    const vals = keys.map(k => fields[k]);
    const r = await this.pool.query(
      `UPDATE hotels SET ${sets}, updated_at=NOW() WHERE id=$${keys.length + 1} RETURNING *`,
      [...vals, id]
    );
    return r.rows[0];
  }

  async delete(id) {
    await this.pool.query('DELETE FROM hotels WHERE id=$1', [id]);
  }
}

module.exports = HotelsDAO;
