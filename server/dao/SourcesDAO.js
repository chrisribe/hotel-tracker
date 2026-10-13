class SourcesDAO {
  constructor(db) { this.db = db; }

  async listForIdeas(itemIds) {
    const r = await this.db.query(`SELECT s.*, p.name AS author_name
      FROM research_sources s LEFT JOIN participants p ON p.id = s.created_by
      WHERE s.item_id = ANY($1) ORDER BY s.created_at, s.id`, [itemIds]);
    return r.rows;
  }

  async find(itemId, id) {
    const r = await this.db.query('SELECT * FROM research_sources WHERE id = $1 AND item_id = $2', [id, itemId]);
    return r.rows[0];
  }

  async count(itemId) {
    const r = await this.db.query('SELECT COUNT(*)::int AS count FROM research_sources WHERE item_id = $1', [itemId]);
    return r.rows[0].count;
  }

  async create(itemId, participantId, { label, url, takeaway }) {
    await this.db.query('INSERT INTO research_sources (item_id, label, url, takeaway, created_by) VALUES ($1, $2, $3, $4, $5)',
      [itemId, label, url, takeaway, participantId]);
  }

  async update(itemId, id, { label, url, takeaway }) {
    await this.db.query('UPDATE research_sources SET label = $1, url = $2, takeaway = $3 WHERE id = $4 AND item_id = $5',
      [label, url, takeaway, id, itemId]);
  }

  async delete(itemId, id) {
    await this.db.query('DELETE FROM research_sources WHERE id = $1 AND item_id = $2', [id, itemId]);
  }
}

module.exports = SourcesDAO;
