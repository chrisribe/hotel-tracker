// One row per idea, with what a card needs: author, last editor, counts, the viewer's vote and the cover photo.
// $1 = trip id, $2 = viewing participant id.
const CARD_SELECT = `
  SELECT i.*, author.name AS author_name, author.is_agent AS author_is_agent,
    editor.name AS editor_name, (editor.id IS NOT NULL AND NOT editor.is_agent) AS human_corrected,
    my_vote.item_id IS NOT NULL AS voted,
    (SELECT COUNT(*)::int FROM research_votes v WHERE v.item_id = i.id) AS vote_count,
    (SELECT COUNT(*)::int FROM research_comments c WHERE c.item_id = i.id) AS comment_count,
    (SELECT COUNT(*)::int FROM research_sources s WHERE s.item_id = i.id) AS source_count,
    (SELECT COUNT(*)::int FROM research_images m WHERE m.item_id = i.id) AS image_count,
    CASE WHEN cover.id IS NULL THEN NULL
      ELSE json_build_object('id', cover.id, 'url', cover.url, 'caption', cover.caption, 'source_url', cover.source_url)
    END AS cover_image
  FROM research_items i
  LEFT JOIN participants author ON author.id = i.created_by
  LEFT JOIN participants editor ON editor.id = i.last_edited_by
  LEFT JOIN research_votes my_vote ON my_vote.item_id = i.id AND my_vote.participant_id = $2
  LEFT JOIN research_images cover ON cover.item_id = i.id AND cover.is_cover
  WHERE i.trip_id = $1`;

class IdeasDAO {
  constructor(db) { this.db = db; }

  async find(tripId, participantId, id) {
    const r = await this.db.query(`${CARD_SELECT} AND i.id = $3`, [tripId, participantId, id]);
    return r.rows[0];
  }

  async list(tripId, participantId, { kind, destination, q, view }) {
    const r = await this.db.query(`${CARD_SELECT}
      AND ($3 = 'all' OR i.kind = $3)
      AND ($4::int IS NULL OR i.destination_id = $4 OR i.id = $4)
      AND ($5 = '' OR strpos(lower(i.title || ' ' || COALESCE(i.location, '') || ' ' || COALESCE(i.notes, '')), lower($5)) > 0)
      AND ($6 = 'all' OR ($6 = 'shortlisted' AND i.status = 'shortlisted') OR ($6 = 'selected' AND i.status IN ('selected', 'booked')))
      ORDER BY i.created_at DESC, i.id DESC`,
    [tripId, participantId, kind, destination || null, q, view]);
    return r.rows;
  }

  async listByKind(tripId, participantId, kind) {
    const r = await this.db.query(`${CARD_SELECT} AND i.kind = $3 ORDER BY i.created_at DESC, i.id DESC`, [tripId, participantId, kind]);
    return r.rows;
  }

  async listSelected(tripId, participantId) {
    const r = await this.db.query(`${CARD_SELECT} AND i.status IN ('selected', 'booked') ORDER BY i.created_at, i.id`, [tripId, participantId]);
    return r.rows;
  }

  async listDestinations(tripId) {
    const r = await this.db.query(
      "SELECT id, title, status FROM research_items WHERE trip_id = $1 AND kind = 'destination' ORDER BY title, id", [tripId]);
    return r.rows;
  }

  async findDestination(tripId, id) {
    const r = await this.db.query("SELECT id FROM research_items WHERE id = $1 AND trip_id = $2 AND kind = 'destination'", [id, tripId]);
    return r.rows[0];
  }

  async hasLinkedIdeas(tripId, destinationId) {
    const r = await this.db.query('SELECT 1 FROM research_items WHERE trip_id = $1 AND destination_id = $2 LIMIT 1', [tripId, destinationId]);
    return r.rows.length > 0;
  }

  async countByKindAndStatus(tripId) {
    const r = await this.db.query('SELECT kind, status, COUNT(*)::int AS count FROM research_items WHERE trip_id = $1 GROUP BY kind, status', [tripId]);
    return r.rows;
  }

  // Only selected/booked quotes for real expenses count toward the plan estimate.
  async selectedTotals(tripId) {
    const r = await this.db.query(`SELECT currency, SUM(cost) AS total FROM research_items
      WHERE trip_id = $1 AND kind IN ('stay', 'transport', 'activity') AND status IN ('selected', 'booked') AND cost IS NOT NULL
      GROUP BY currency ORDER BY currency`, [tripId]);
    return r.rows;
  }

  async countSelectedWithoutCost(tripId) {
    const r = await this.db.query(`SELECT COUNT(*)::int AS count FROM research_items
      WHERE trip_id = $1 AND kind IN ('stay', 'transport', 'activity') AND status IN ('selected', 'booked') AND cost IS NULL`, [tripId]);
    return r.rows[0].count;
  }

  async create(tripId, participantId, v) {
    const r = await this.db.query(`INSERT INTO research_items
      (trip_id, kind, title, location, notes, url, destination_id, cost, currency, capacity, created_by, details, last_refresh_note)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13) RETURNING *`,
    [tripId, v.kind, v.title, v.location, v.notes, v.url, v.destination_id, v.cost, v.currency, v.capacity, participantId, JSON.stringify(v.details || []), v.last_refresh_note || null]);
    return r.rows[0];
  }

  // editorId is null when nothing changed, so a no-op save keeps the last editor.
  async update(tripId, id, v, editorId) {
    const r = await this.db.query(`UPDATE research_items SET kind = $1, title = $2, location = $3, notes = $4, url = $5,
      destination_id = $6, cost = $7, currency = $8, capacity = $9, details = $12::jsonb, last_refresh_note = $13, updated_at = NOW(),
      last_edited_by = COALESCE($14, last_edited_by), last_edited_at = CASE WHEN $14::int IS NULL THEN last_edited_at ELSE NOW() END
      WHERE id = $10 AND trip_id = $11 RETURNING *`,
    [v.kind, v.title, v.location, v.notes, v.url, v.destination_id, v.cost, v.currency, v.capacity, id, tripId, JSON.stringify(v.details || []), v.last_refresh_note || null, editorId]);
    return r.rows[0];
  }

  async setStatus(tripId, id, status) {
    await this.db.query('UPDATE research_items SET status = $1, updated_at = NOW() WHERE id = $2 AND trip_id = $3', [status, id, tripId]);
  }

  async delete(tripId, id) {
    await this.db.query('DELETE FROM research_items WHERE id = $1 AND trip_id = $2', [id, tripId]);
  }
}

module.exports = IdeasDAO;
