class TripsDAO {
  constructor(pool) { this.pool = pool; }

  async create({ name, description, destination, travel_start, travel_end, currency, travelers, brief_text, brief_meta }) {
    const r = await this.pool.query(
      `INSERT INTO trips (name, description, destination, travel_start, travel_end, currency, travelers, brief_text, brief_meta, brief_updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb, CASE WHEN $8::text IS NULL AND $9::jsonb IS NULL THEN NULL ELSE NOW() END) RETURNING *`,
      [name, description ?? null, destination || null, travel_start || null, travel_end || null, currency, travelers ?? null,
        brief_text || null, brief_meta == null ? null : JSON.stringify(brief_meta)]
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

  // brief_updated_at moves only when the brief itself changes.
  async update(id, { name, description, destination, travel_start, travel_end, currency, travelers, brief_text, brief_meta }) {
    const r = await this.pool.query(
      `UPDATE trips SET name=$1, description=$2, destination=$3, travel_start=$4, travel_end=$5, currency=$6, travelers=$7,
         brief_updated_at = CASE WHEN brief_text IS DISTINCT FROM $9::text OR brief_meta IS DISTINCT FROM $10::jsonb THEN NOW() ELSE brief_updated_at END,
         brief_text=$9, brief_meta=$10::jsonb
       WHERE id=$8 RETURNING *`,
      [name, description ?? null, destination || null, travel_start || null, travel_end || null, currency, travelers ?? null, id,
        brief_text || null, brief_meta == null ? null : JSON.stringify(brief_meta)]
    );
    return r.rows[0];
  }

  // Keeps the first request time if one is already waiting; the latest mode wins.
  async requestGeneration(id, mode) {
    const r = await this.pool.query(
      'UPDATE trips SET generation_requested_at = COALESCE(generation_requested_at, NOW()), generation_mode = $2 WHERE id = $1 RETURNING *', [id, mode]);
    return r.rows[0];
  }

  // Drops a waiting request without touching the last run.
  async cancelGeneration(id) {
    const r = await this.pool.query('UPDATE trips SET generation_requested_at = NULL, generation_mode = NULL WHERE id = $1 RETURNING *', [id]);
    return r.rows[0];
  }

  // Clears the pending request unless a newer one arrived after the run started (requestedAt = what the run picked up).
  async finishRun(id, summary, requestedAt) {
    const r = await this.pool.query(
      `UPDATE trips SET last_run_at = NOW(), last_run_summary = $2::jsonb,
         generation_mode = CASE WHEN $3::timestamptz IS NULL OR date_trunc('milliseconds', generation_requested_at) <= $3 THEN NULL ELSE generation_mode END,
         generation_requested_at = CASE WHEN $3::timestamptz IS NULL OR date_trunc('milliseconds', generation_requested_at) <= $3 THEN NULL ELSE generation_requested_at END
       WHERE id = $1 RETURNING *`,
      [id, JSON.stringify(summary), requestedAt]);
    return r.rows[0];
  }

  // Waiting requests, oldest first. Trips where the assistant was removed are skipped.
  async listGenerationQueue(limit) {
    const r = await this.pool.query(
      `SELECT t.id AS trip_id, t.name AS trip_name, t.generation_mode AS mode, t.generation_requested_at AS requested_at,
              t.brief_text, t.brief_meta, t.brief_updated_at, t.last_run_at
       FROM trips t
       WHERE t.generation_requested_at IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM participants p WHERE p.trip_id = t.id AND p.is_agent AND NOT p.active)
       ORDER BY t.generation_requested_at, t.id LIMIT $1`, [limit]);
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
