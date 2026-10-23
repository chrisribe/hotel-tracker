const schema = `
-- Organizer accounts, created with "npm run create-user" (no public sign-up). Guests join trips by invite instead.
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9_.-]{3,40}$'),
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trips (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  destination TEXT,
  travel_start DATE,
  travel_end DATE,
  currency TEXT NOT NULL DEFAULT 'CAD' CHECK (currency IN ('CAD','USD','EUR','GBP')),
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE trips ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'CAD' CHECK (currency IN ('CAD','USD','EUR','GBP'));
ALTER TABLE trips ADD COLUMN IF NOT EXISTS travelers INTEGER CHECK (travelers BETWEEN 1 AND 100);
-- The separate Trip Butler brief was folded into the trip description ("What are you thinking?").
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'trips' AND column_name = 'brief_text') THEN
    UPDATE trips SET description = CASE WHEN COALESCE(btrim(description), '') = '' THEN brief_text ELSE description || E'\\n\\n' || brief_text END
    WHERE COALESCE(btrim(brief_text), '') <> '' AND COALESCE(description, '') NOT LIKE '%' || brief_text || '%';
  END IF;
END $$;
ALTER TABLE trips DROP COLUMN IF EXISTS brief_text, DROP COLUMN IF EXISTS brief_meta, DROP COLUMN IF EXISTS brief_updated_at, DROP COLUMN IF EXISTS generation_mode;
-- One pending request per trip (Hermes pulls it), plus the last finished run.
ALTER TABLE trips ADD COLUMN IF NOT EXISTS generation_requested_at TIMESTAMPTZ;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS generation_run_id UUID;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS generation_expires_at TIMESTAMPTZ;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS generation_usage JSONB NOT NULL DEFAULT '{"creations":0,"comments":0,"writes":0}'::jsonb;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS last_run_at TIMESTAMPTZ;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS last_run_summary JSONB;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS last_run_description TEXT;
-- One open question from any member for the Trip Butler, and today's count of runs members' questions started.
ALTER TABLE trips ADD COLUMN IF NOT EXISTS butler_question TEXT CHECK (char_length(butler_question) <= 500);
ALTER TABLE trips ADD COLUMN IF NOT EXISTS butler_question_at TIMESTAMPTZ;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS runs_day DATE;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS runs_today INTEGER NOT NULL DEFAULT 0;
-- Butler session policy: one-shot run, fixed window, or unlimited until canceled.
ALTER TABLE trips ADD COLUMN IF NOT EXISTS butler_session_mode TEXT NOT NULL DEFAULT 'single'
  CHECK (butler_session_mode IN ('single','windowed','unlimited'));
ALTER TABLE trips ADD COLUMN IF NOT EXISTS butler_session_minutes INTEGER NOT NULL DEFAULT 60
  CHECK (butler_session_minutes BETWEEN 5 AND 10080);
-- The account that organizes the trip. Trips from before accounts have none until create-user claims them.
ALTER TABLE trips ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES users(id);
CREATE INDEX IF NOT EXISTS trips_owner ON trips(owner_id);
DROP INDEX IF EXISTS one_demo_trip;
CREATE UNIQUE INDEX IF NOT EXISTS one_demo_per_owner ON trips(owner_id) WHERE is_demo;

CREATE TABLE IF NOT EXISTS participants (
  id SERIAL PRIMARY KEY,
  trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  is_organizer BOOLEAN NOT NULL DEFAULT FALSE,
  is_agent BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (id, trip_id),
  CHECK (NOT (is_organizer AND is_agent))
);
CREATE INDEX IF NOT EXISTS participants_trip ON participants(trip_id);
CREATE UNIQUE INDEX IF NOT EXISTS one_trip_organizer ON participants(trip_id) WHERE is_organizer;
CREATE UNIQUE INDEX IF NOT EXISTS one_trip_agent ON participants(trip_id) WHERE is_agent;

CREATE TABLE IF NOT EXISTS research_items (
  id SERIAL PRIMARY KEY,
  trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('destination','stay','transport','activity','link')),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  location TEXT,
  notes TEXT,
  url TEXT,
  destination_id INTEGER,
  cost NUMERIC(14,2) CHECK (cost >= 0),
  currency TEXT NOT NULL DEFAULT 'CAD' CHECK (currency IN ('CAD','USD','EUR','GBP')),
  capacity INTEGER CHECK (capacity BETWEEN 1 AND 100000),
  status TEXT NOT NULL DEFAULT 'considering' CHECK (status IN ('considering','shortlisted','selected','booked','eliminated')),
  created_by INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, trip_id),
  CHECK (destination_id IS NULL OR (destination_id <> id AND kind <> 'destination')),
  FOREIGN KEY (destination_id, trip_id) REFERENCES research_items(id, trip_id) ON DELETE SET NULL (destination_id),
  FOREIGN KEY (created_by, trip_id) REFERENCES participants(id, trip_id)
);
ALTER TABLE research_items ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE research_items ADD COLUMN IF NOT EXISTS last_refresh_note TEXT CHECK (char_length(last_refresh_note) <= 300);
-- Any member may correct an idea; the last editor is shown.
ALTER TABLE research_items ADD COLUMN IF NOT EXISTS last_edited_by INTEGER REFERENCES participants(id);
ALTER TABLE research_items ADD COLUMN IF NOT EXISTS last_edited_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS research_items_trip ON research_items(trip_id);
CREATE INDEX IF NOT EXISTS research_items_destination ON research_items(destination_id);

CREATE TABLE IF NOT EXISTS research_comments (
  id SERIAL PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES research_items(id) ON DELETE CASCADE,
  participant_id INTEGER NOT NULL REFERENCES participants(id),
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS research_comments_item ON research_comments(item_id);
CREATE TABLE IF NOT EXISTS research_votes (
  item_id INTEGER NOT NULL REFERENCES research_items(id) ON DELETE CASCADE,
  participant_id INTEGER NOT NULL REFERENCES participants(id),
  PRIMARY KEY (item_id, participant_id)
);
CREATE TABLE IF NOT EXISTS trip_invites (
  trip_id INTEGER PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  secret_token TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Provision organizer and invite on creation so GET pages stay read-only.
CREATE OR REPLACE FUNCTION provision_trip_access() RETURNS TRIGGER AS $$
DECLARE raw_token TEXT;
BEGIN
  raw_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  INSERT INTO participants(trip_id,name,is_organizer) VALUES(NEW.id,'Organizer',TRUE);
  INSERT INTO trip_invites(trip_id,token_hash,secret_token)
    VALUES(NEW.id,encode(sha256(convert_to(raw_token,'UTF8')),'hex'),raw_token);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE OR REPLACE TRIGGER provision_trip_access AFTER INSERT ON trips
  FOR EACH ROW EXECUTE FUNCTION provision_trip_access();

CREATE TABLE IF NOT EXISTS planner_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS planner_sessions (
  sid VARCHAR PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS planner_sessions_expire ON planner_sessions(expire);
CREATE TABLE IF NOT EXISTS planner_attempts (
  key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS planner_attempts_expiry ON planner_attempts(expires_at);

CREATE TABLE IF NOT EXISTS research_sources (
  id SERIAL PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES research_items(id) ON DELETE CASCADE,
  label TEXT NOT NULL CHECK (char_length(btrim(label))>0 AND char_length(label)<=120),
  url TEXT NOT NULL CHECK (char_length(url) BETWEEN 1 AND 2048 AND url ~ '^https?://[^/?#]+'
    AND url !~ '[[:space:][:cntrl:]]' AND strpos(url,chr(92))=0 AND url !~ '^https?://[^/?#]*@'),
  created_by INTEGER REFERENCES participants(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS research_sources_item ON research_sources(item_id);
ALTER TABLE research_sources DROP COLUMN IF EXISTS takeaway;
CREATE TABLE IF NOT EXISTS research_images (
  id SERIAL PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES research_items(id) ON DELETE CASCADE,
  url TEXT NOT NULL CHECK (char_length(url) BETWEEN 1 AND 2048 AND url ~ '^https://[^/?#]+'
    AND url !~ '[[:space:][:cntrl:]]' AND strpos(url,chr(92))=0 AND url !~ '^https://[^/?#]*@'),
  caption TEXT NOT NULL DEFAULT '' CHECK (char_length(caption)<=300),
  source_url TEXT CHECK (source_url IS NULL OR (char_length(source_url) BETWEEN 1 AND 2048 AND source_url ~ '^https?://[^/?#]+'
    AND source_url !~ '[[:space:][:cntrl:]]' AND strpos(source_url,chr(92))=0 AND source_url !~ '^https?://[^/?#]*@')),
  is_cover BOOLEAN NOT NULL DEFAULT FALSE,
  created_by INTEGER REFERENCES participants(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS research_images_item ON research_images(item_id);
CREATE UNIQUE INDEX IF NOT EXISTS research_images_one_cover ON research_images(item_id) WHERE is_cover;
`;

// Request validation for references; never fetch or resolve DNS.
function normalizeReferenceUrl(value, image = false) {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value) || value.length > 2048 || /[\s\u0000-\u001f\u007f\\]/u.test(value) || /^https?:\/\/[^/?#]*@/i.test(value)) throw new Error('Invalid URL');
  const parsed = new URL(value);
  if (!(image ? ['https:'] : ['http:', 'https:']).includes(parsed.protocol) || parsed.username || parsed.password || parsed.href.length > 2048) throw new Error('Invalid URL');
  if (image) {
    const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
    const ipv6 = host.startsWith('[') ? host.slice(1, -1) : '';
    const octets = /^\d+\.\d+\.\d+\.\d+$/.test(host) ? host.split('.').map(Number) : null;
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
        (!host.includes('.') && !ipv6) ||
        (ipv6 && (/^::/.test(ipv6) || /^(?:f[cd]|fe[89abcdef]|ff)/.test(ipv6))) ||
        (octets && (octets[0] === 0 || octets[0] === 10 || octets[0] === 127 || octets[0] >= 224 ||
          (octets[0] === 169 && octets[1] === 254) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
          (octets[0] === 192 && octets[1] === 168) || (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) ||
          (octets[0] === 198 && [18, 19].includes(octets[1]))))) throw new Error('Local image URL');
  }
  return parsed.href;
}

async function transaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function migrate(pool) {
  return transaction(pool, async client => {
    // Serialize boot migrations; schema qualification keeps integration tests isolated.
    await client.query("SELECT pg_advisory_xact_lock(hashtext(current_schema()), hashtext('hotel-tracker-schema'))");
    await client.query(schema);
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'research_sources_created_by_fkey') THEN
          ALTER TABLE research_sources DROP CONSTRAINT research_sources_created_by_fkey;
        END IF;
        ALTER TABLE research_sources
          ADD CONSTRAINT research_sources_created_by_fkey
          FOREIGN KEY (created_by) REFERENCES participants(id) ON DELETE SET NULL;

        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'research_images_created_by_fkey') THEN
          ALTER TABLE research_images DROP CONSTRAINT research_images_created_by_fkey;
        END IF;
        ALTER TABLE research_images
          ADD CONSTRAINT research_images_created_by_fkey
          FOREIGN KEY (created_by) REFERENCES participants(id) ON DELETE SET NULL;
      END
      $$;
    `);
  });
}

module.exports = { migrate, transaction, normalizeReferenceUrl };

if (require.main === module) {
  require('dotenv').config();
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  migrate(pool)
    .then(() => console.log('Schema ready.'))
    .catch(error => { console.error('Schema initialization failed:', error.message); process.exitCode = 1; })
    .finally(() => pool.end());
}
