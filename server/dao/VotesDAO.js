class VotesDAO {
  constructor(db) { this.db = db; }

  async toggle(itemId, participantId) {
    const deleted = await this.db.query('DELETE FROM research_votes WHERE item_id = $1 AND participant_id = $2', [itemId, participantId]);
    if (!deleted.rowCount) {
      await this.db.query('INSERT INTO research_votes (item_id, participant_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [itemId, participantId]);
    }
  }
}

module.exports = VotesDAO;
