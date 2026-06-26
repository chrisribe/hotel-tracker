require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

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

async function init() {
  console.log('Initialising schema...');
  await pool.query(schema);
  console.log('Done.');
  await pool.end();
}

init().catch(err => { console.error(err); process.exit(1); });
