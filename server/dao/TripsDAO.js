class TripsDAO {
  constructor(pool) { this.pool = pool; }

  async create({ name, description, destination, travel_start, travel_end, currency, travelers }) {
    const r = await this.pool.query(
      `INSERT INTO trips (name, description, destination, travel_start, travel_end, currency, travelers)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [name, description ?? null, destination || null, travel_start || null, travel_end || null, currency, travelers ?? null]
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

  async update(id, { name, description, destination, travel_start, travel_end, currency, travelers }) {
    const r = await this.pool.query(
      `UPDATE trips SET name=$1, description=$2, destination=$3, travel_start=$4, travel_end=$5, currency=$6, travelers=$7
       WHERE id=$8 RETURNING *`,
      [name, description ?? null, destination || null, travel_start || null, travel_end || null, currency, travelers ?? null, id]
    );
    return r.rows[0];
  }

  // Keeps the waiting request (time, run ID, usage) if there is one; otherwise starts a fresh run.
  async requestGeneration(id) {
    const r = await this.pool.query(
      `UPDATE trips SET
         generation_run_id = CASE WHEN generation_requested_at IS NULL OR generation_expires_at <= statement_timestamp() OR generation_run_id IS NULL THEN gen_random_uuid() ELSE generation_run_id END,
         generation_usage = CASE WHEN generation_requested_at IS NULL OR generation_expires_at <= statement_timestamp() OR generation_run_id IS NULL THEN '{"creations":0,"comments":0,"writes":0}'::jsonb ELSE generation_usage END,
         generation_expires_at = CASE WHEN generation_requested_at IS NULL OR generation_expires_at <= statement_timestamp() OR generation_run_id IS NULL THEN statement_timestamp() + interval '1 hour' ELSE generation_expires_at END,
         generation_requested_at = CASE WHEN generation_requested_at IS NULL OR generation_expires_at <= statement_timestamp() OR generation_run_id IS NULL THEN statement_timestamp() ELSE generation_requested_at END
       WHERE id = $1 RETURNING *`, [id]);
    return r.rows[0];
  }

  // Drops a waiting request without touching the last run.
  async cancelGeneration(id) {
    const r = await this.pool.query('UPDATE trips SET generation_requested_at = NULL, generation_run_id = NULL, generation_expires_at = NULL WHERE id = $1 RETURNING *', [id]);
    return r.rows[0];
  }

  // Clears the pending request unless a newer one arrived after the run started (requestedAt = what the run picked up).
  // The question is cleared only if it is not newer than the one the run saw (questionAt, else requestedAt).
  // Keeps the description as of this run so the next run can see what changed.
  async finishRun(id, summary, requestedAt, questionAt = null) {
    const r = await this.pool.query(
      `UPDATE trips SET last_run_at = NOW(), last_run_summary = $2::jsonb, last_run_description = description,
        generation_run_id = CASE WHEN $3::timestamptz IS NULL OR date_trunc('milliseconds', generation_requested_at) <= $3 THEN NULL ELSE generation_run_id END,
        generation_expires_at = CASE WHEN $3::timestamptz IS NULL OR date_trunc('milliseconds', generation_requested_at) <= $3 THEN NULL ELSE generation_expires_at END,
         generation_requested_at = CASE WHEN $3::timestamptz IS NULL OR date_trunc('milliseconds', generation_requested_at) <= $3 THEN NULL ELSE generation_requested_at END,
         butler_question = CASE WHEN COALESCE($4::timestamptz, $3) IS NULL OR date_trunc('milliseconds', butler_question_at) <= COALESCE($4, $3) THEN NULL ELSE butler_question END,
         butler_question_at = CASE WHEN COALESCE($4::timestamptz, $3) IS NULL OR date_trunc('milliseconds', butler_question_at) <= COALESCE($4, $3) THEN NULL ELSE butler_question_at END
       WHERE id = $1 RETURNING *`,
      [id, JSON.stringify(summary), requestedAt, questionAt]);
    return r.rows[0];
  }

  // The trip's one open question for the Trip Butler; a new one replaces it.
  async setQuestion(id, question) {
    const r = await this.pool.query('UPDATE trips SET butler_question = $2, butler_question_at = statement_timestamp() WHERE id = $1 RETURNING *', [id, question]);
    return r.rows[0];
  }

  // Counts a run started by a member's question; false when today's limit is already reached.
  async countMemberRun(id, limit) {
    const r = await this.pool.query(`UPDATE trips SET runs_today = CASE WHEN runs_day = CURRENT_DATE THEN runs_today + 1 ELSE 1 END, runs_day = CURRENT_DATE
      WHERE id = $1 AND (runs_day IS DISTINCT FROM CURRENT_DATE OR runs_today < $2) RETURNING id`, [id, limit]);
    return r.rows.length > 0;
  }

  // Live (unexpired) requests, oldest first. Trips where the assistant was removed are skipped.
  // mode: 'generate' until the assistant has added an idea to the trip, then 'refresh'.
  async listGenerationQueue(limit) {
    const r = await this.pool.query(
      `SELECT t.id AS trip_id, t.name AS trip_name, t.description, t.destination,
              to_char(t.travel_start, 'YYYY-MM-DD') AS travel_start, to_char(t.travel_end, 'YYYY-MM-DD') AS travel_end,
              t.travelers, t.currency,
              CASE WHEN EXISTS (SELECT 1 FROM research_items i JOIN participants p ON p.id = i.created_by WHERE i.trip_id = t.id AND p.is_agent)
                THEN 'refresh' ELSE 'generate' END AS mode,
              t.generation_requested_at AS requested_at, t.last_run_at, t.last_run_description AS previous_description,
              t.generation_run_id AS run_id, t.generation_expires_at AS expires_at,
              t.butler_question AS question, t.butler_question_at AS question_at
       FROM trips t
       WHERE t.generation_requested_at IS NOT NULL
         AND t.generation_run_id IS NOT NULL AND t.generation_expires_at > clock_timestamp()
         AND NOT EXISTS (SELECT 1 FROM participants p WHERE p.trip_id = t.id AND p.is_agent AND NOT p.active)
       ORDER BY t.generation_requested_at, t.id LIMIT $1`, [limit]);
    return r.rows;
  }

  // Called only while holding this trip's FOR UPDATE lock; rolled back with the mutation.
  async saveGenerationUsage(id, usage) {
    await this.pool.query('UPDATE trips SET generation_usage = $2::jsonb WHERE id = $1', [id, JSON.stringify(usage)]);
  }

  async activeGeneration(id, runId) {
    const r = await this.pool.query(`SELECT 1 FROM trips WHERE id = $1 AND generation_run_id = $2::uuid
      AND generation_requested_at IS NOT NULL AND generation_expires_at > clock_timestamp()`, [id, runId]);
    return r.rows.length > 0;
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
