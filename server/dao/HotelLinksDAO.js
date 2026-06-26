class HotelLinksDAO {
  constructor(pool) { this.pool = pool; }

  async addLink({ hotel_id, link_type, url, title, thumbnail_url, metadata }) {
    const r = await this.pool.query(
      `INSERT INTO hotel_links (hotel_id, link_type, url, title, thumbnail_url, metadata)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [hotel_id, link_type, url, title || null, thumbnail_url || null, metadata || {}]
    );
    return r.rows[0];
  }

  async deleteLink(id) {
    await this.pool.query('DELETE FROM hotel_links WHERE id=$1', [id]);
  }
}

module.exports = HotelLinksDAO;
