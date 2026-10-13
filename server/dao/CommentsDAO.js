class CommentsDAO {
  constructor(db) { this.db = db; }

  async listForIdea(itemId) {
    const r = await this.db.query(`SELECT c.id, c.body, c.created_at, p.name AS author_name
      FROM research_comments c JOIN participants p ON p.id = c.participant_id
      WHERE c.item_id = $1 ORDER BY c.created_at, c.id`, [itemId]);
    return r.rows;
  }

  async create(itemId, participantId, body) {
    await this.db.query('INSERT INTO research_comments (item_id, participant_id, body) VALUES ($1, $2, $3)', [itemId, participantId, body]);
  }
}

module.exports = CommentsDAO;
