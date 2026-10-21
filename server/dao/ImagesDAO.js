class ImagesDAO {
  constructor(db) { this.db = db; }

  async listForIdeas(itemIds) {
    const r = await this.db.query(`SELECT m.*, p.name AS author_name
      FROM research_images m LEFT JOIN participants p ON p.id = m.created_by
      WHERE m.item_id = ANY($1) ORDER BY m.created_at, m.id`, [itemIds]);
    return r.rows;
  }

  async find(itemId, id) {
    const r = await this.db.query('SELECT * FROM research_images WHERE id = $1 AND item_id = $2', [id, itemId]);
    return r.rows[0];
  }

  async count(itemId) {
    const r = await this.db.query('SELECT COUNT(*)::int AS count FROM research_images WHERE item_id = $1', [itemId]);
    return r.rows[0].count;
  }

  async create(itemId, participantId, { url, caption, source_url }, isCover) {
    await this.db.query('INSERT INTO research_images (item_id, url, caption, source_url, is_cover, created_by) VALUES ($1, $2, $3, $4, $5, $6)',
      [itemId, url, caption, source_url, isCover, participantId]);
  }

  async update(itemId, id, { url, caption, source_url }) {
    await this.db.query('UPDATE research_images SET url = $1, caption = $2, source_url = $3 WHERE id = $4 AND item_id = $5',
      [url, caption, source_url, id, itemId]);
  }

  async delete(itemId, id) {
    await this.db.query('DELETE FROM research_images WHERE id = $1 AND item_id = $2', [id, itemId]);
  }

  // A unique index allows one cover per idea, so clear the old one first.
  async setCover(itemId, id) {
    await this.db.query('UPDATE research_images SET is_cover = FALSE WHERE item_id = $1 AND is_cover', [itemId]);
    await this.db.query('UPDATE research_images SET is_cover = TRUE WHERE item_id = $1 AND id = $2', [itemId, id]);
  }

  async coverOldest(itemId) {
    await this.db.query(`UPDATE research_images SET is_cover = TRUE
      WHERE id = (SELECT id FROM research_images WHERE item_id = $1 ORDER BY created_at, id LIMIT 1)`, [itemId]);
  }
}

module.exports = ImagesDAO;
