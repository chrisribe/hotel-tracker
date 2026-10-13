const schema = `
-- Trips
CREATE TABLE IF NOT EXISTS trips (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  destination TEXT,
  travel_start DATE,
  travel_end   DATE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Hotels
CREATE TABLE IF NOT EXISTS hotels (
  id           SERIAL PRIMARY KEY,
  trip_id      INT REFERENCES trips(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  destination  TEXT,
  price_min    INT,
  price_max    INT,
  price_currency TEXT DEFAULT 'CAD',
  price_type   TEXT DEFAULT 'all_inclusive_pp',
  price_display TEXT,
  status       TEXT DEFAULT 'considering'
               CHECK (status IN ('considering','eliminated','booked')),
  sort_order   INT DEFAULT 0,
  thumbnail_url TEXT,
  description  TEXT,
  notes        TEXT,
  pros         TEXT[] DEFAULT '{}',
  cons         TEXT[] DEFAULT '{}',
  -- 6-dimension ratings
  rating_beach    INT CHECK (rating_beach    BETWEEN 1 AND 5),
  rating_property INT CHECK (rating_property BETWEEN 1 AND 5),
  rating_food     INT CHECK (rating_food     BETWEEN 1 AND 5),
  rating_pools    INT CHECK (rating_pools    BETWEEN 1 AND 5),
  rating_location INT CHECK (rating_location BETWEEN 1 AND 5),
  rating_value    INT CHECK (rating_value    BETWEEN 1 AND 5),
  -- Public review data
  google_place_id TEXT,
  review_score    NUMERIC(3,1),
  review_count    INT,
  review_tags_praise   TEXT[] DEFAULT '{}',
  review_tags_concerns TEXT[] DEFAULT '{}',
  review_trust  TEXT CHECK (review_trust IN ('genuine','warn','suspicious')),
  review_scanned_at TIMESTAMPTZ,
  enriched_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Links (YouTube, hotel site, package, etc.)
CREATE TABLE IF NOT EXISTS hotel_links (
  id         SERIAL PRIMARY KEY,
  hotel_id   INT REFERENCES hotels(id) ON DELETE CASCADE,
  link_type  TEXT NOT NULL CHECK (link_type IN ('youtube','hotel_site','package','review','other')),
  url        TEXT NOT NULL,
  title      TEXT,
  thumbnail_url TEXT,
  metadata   JSONB DEFAULT '{}',
  added_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_hotels_trip_id   ON hotels(trip_id);
CREATE INDEX IF NOT EXISTS idx_hotels_status    ON hotels(status);
CREATE INDEX IF NOT EXISTS idx_hotel_links_hotel ON hotel_links(hotel_id);
`;

const plannerSchema = `
ALTER TABLE trips ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS one_demo_trip ON trips(is_demo) WHERE is_demo;

CREATE TABLE IF NOT EXISTS participants (
  id SERIAL PRIMARY KEY,
  trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  is_organizer BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (id, trip_id)
);
CREATE INDEX IF NOT EXISTS participants_trip ON participants(trip_id);
CREATE UNIQUE INDEX IF NOT EXISTS one_trip_organizer ON participants(trip_id) WHERE is_organizer;

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

-- Provision access metadata on creation, including trips created by the legacy routes.
-- This keeps GET pages read-only; invitations are never first-created by a GET.
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
INSERT INTO participants(trip_id,name,is_organizer)
  SELECT id,'Organizer',TRUE FROM trips
  ON CONFLICT(trip_id) WHERE is_organizer DO NOTHING;
WITH missing AS MATERIALIZED (
  SELECT id,replace(gen_random_uuid()::text || gen_random_uuid()::text,'-','') AS raw_token
  FROM trips WHERE NOT EXISTS(SELECT 1 FROM trip_invites WHERE trip_id=trips.id)
)
INSERT INTO trip_invites(trip_id,token_hash,secret_token)
  SELECT id,encode(sha256(convert_to(raw_token,'UTF8')),'hex'),raw_token FROM missing
  ON CONFLICT(trip_id) DO NOTHING;

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
`;

const researchSchema = `
-- Replace only the status-only CHECK, including its name in early draft databases.
DO $$ DECLARE constraint_name TEXT;
BEGIN
  FOR constraint_name IN
    SELECT c.conname FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attname='status'
    WHERE c.conrelid='research_items'::regclass AND c.contype='c'
      AND c.conkey=ARRAY[a.attnum]::smallint[]
  LOOP
    EXECUTE format('ALTER TABLE research_items DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;
ALTER TABLE research_items ADD CONSTRAINT research_items_status_check
  CHECK (status IN ('considering','shortlisted','selected','booked','eliminated'));

CREATE TABLE research_sources (
  id SERIAL PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES research_items(id) ON DELETE CASCADE,
  label TEXT NOT NULL CHECK (char_length(btrim(label))>0 AND char_length(label)<=120),
  url TEXT NOT NULL CHECK (char_length(url) BETWEEN 1 AND 2048 AND url ~ '^https?://[^/?#]+'
    AND url !~ '[[:space:][:cntrl:]]' AND strpos(url,chr(92))=0 AND url !~ '^https?://[^/?#]*@'),
  takeaway TEXT NOT NULL DEFAULT '' CHECK (char_length(takeaway)<=2000),
  created_by INTEGER REFERENCES participants(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX research_sources_item ON research_sources(item_id);
CREATE TABLE research_images (
  id SERIAL PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES research_items(id) ON DELETE CASCADE,
  url TEXT NOT NULL CHECK (char_length(url) BETWEEN 1 AND 2048 AND url ~ '^https://[^/?#]+'
    AND url !~ '[[:space:][:cntrl:]]' AND strpos(url,chr(92))=0 AND url !~ '^https://[^/?#]*@'),
  caption TEXT NOT NULL DEFAULT '' CHECK (char_length(caption)<=300),
  source_url TEXT CHECK (source_url IS NULL OR (char_length(source_url) BETWEEN 1 AND 2048 AND source_url ~ '^https?://[^/?#]+'
    AND source_url !~ '[[:space:][:cntrl:]]' AND strpos(source_url,chr(92))=0 AND source_url !~ '^https?://[^/?#]*@')),
  is_cover BOOLEAN NOT NULL DEFAULT FALSE,
  created_by INTEGER REFERENCES participants(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX research_images_item ON research_images(item_id);
CREATE UNIQUE INDEX research_images_one_cover ON research_images(item_id) WHERE is_cover;
`;

// Departure groups, cost basis and quote provenance (trip-planning iteration 3).
const costModelSchema = `
ALTER TABLE participants ADD COLUMN IF NOT EXISTS origin TEXT
  CHECK (origin IS NULL OR char_length(btrim(origin)) BETWEEN 1 AND 80);
ALTER TABLE research_items ADD COLUMN IF NOT EXISTS cost_basis TEXT NOT NULL DEFAULT 'total'
  CHECK (cost_basis IN ('total','per_person','per_day','per_person_per_day'));
ALTER TABLE research_items ADD COLUMN IF NOT EXISTS price_kind TEXT NOT NULL DEFAULT 'estimate'
  CHECK (price_kind IN ('quoted','estimate'));
ALTER TABLE research_items ADD COLUMN IF NOT EXISTS quoted_at DATE;
CREATE TABLE IF NOT EXISTS research_origin_costs (
  item_id INTEGER NOT NULL REFERENCES research_items(id) ON DELETE CASCADE,
  origin TEXT NOT NULL CHECK (char_length(btrim(origin)) BETWEEN 1 AND 80),
  cost NUMERIC(14,2) NOT NULL CHECK (cost >= 0),
  currency TEXT NOT NULL DEFAULT 'CAD' CHECK (currency IN ('CAD','USD','EUR','GBP')),
  PRIMARY KEY (item_id, origin)
);
`;

// Shared by the one-time import and request validation; references only, never fetch or resolve DNS.
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
    await client.query(plannerSchema);
    await client.query('CREATE TABLE IF NOT EXISTS planner_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
    const version = 'research-collections-selected-v1';
    if (!(await client.query('SELECT 1 FROM planner_migrations WHERE version=$1', [version])).rowCount) {
      await client.query(researchSchema);
      const legacy = (await client.query("SELECT id,url,created_by FROM research_items WHERE url IS NOT NULL AND url<>'' ORDER BY id")).rows;
      for (const item of legacy) {
        let url;
        try { url = normalizeReferenceUrl(item.url); } catch { continue; } // Unsafe legacy references remain in the original column only.
        await client.query("INSERT INTO research_sources(item_id,label,url,created_by) VALUES($1,'Original source',$2,$3)", [item.id, url, item.created_by]);
      }
      await client.query('INSERT INTO planner_migrations(version) VALUES($1)', [version]);
    }
    const costVersion = 'cost-model-v1';
    if (!(await client.query('SELECT 1 FROM planner_migrations WHERE version=$1', [costVersion])).rowCount) {
      await client.query(costModelSchema);
      await client.query('INSERT INTO planner_migrations(version) VALUES($1)', [costVersion]);
    }
  });
}

module.exports = { schema, plannerSchema, migrate, transaction, normalizeReferenceUrl };

if (require.main === module) {
  require('dotenv').config();
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  migrate(pool)
    .then(() => console.log('Schema ready.'))
    .catch(error => { console.error('Schema initialization failed:', error.message); process.exitCode = 1; })
    .finally(() => pool.end());
}
