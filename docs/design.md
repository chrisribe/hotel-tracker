# 🏨 Hotel Candidate Tracker — Project Design

**Goal:** A personal web app to log, enrich, and compare hotel candidates when planning vacations (Punta Cana, Vegas, etc.) so you can make a confident final pick.

**Stack:** EventGlimpse framework — EJS + Express + Pico.css + HTMX + Postgres + Docker (deploy on Hetzner)

**Motto:** Add a hotel link → app does the rest.

---

## Vision

When planning a trip, you're juggling 10 browser tabs — hotel sites, YouTube reviews, Google ratings, travel packages. This app collapses that into one place. You paste a link, it auto-enriches with real data. You jot pros/cons, rate it, move on. At the end you have a ranked shortlist and can pick with confidence.

---

## Core Concepts

### Hotel Card
Each hotel candidate is a card with:
- **Name** + **Destination** (e.g. Barceló Bávaro, Punta Cana)
- **Star rating** (from data or manual)
- **Price range** (per night or all-inclusive per person)
- **Your rating** (1–5 stars, your personal take)
- **Status**: `🔵 Considering` / `❌ Eliminated` / `✅ Booked`
- **Pros** (bullet list)
- **Cons** (bullet list)
- **Notes** (freeform)
- **Media** (YouTube video, hotel link, package link)
- **Auto-fetched data** (description, location, amenities, thumbnail)

---

## Features

### Phase 1 — Core (MVP)
- [ ] Add hotel manually (name, destination, price, status)
- [ ] Edit pros/cons/notes inline (HTMX, no page reload)
- [ ] Set personal rating (star widget)
- [ ] Toggle status (considering/eliminated/booked)
- [ ] Dashboard view: all hotels as cards, sorted by rating
- [ ] Trip scoping: group hotels by trip (e.g. "Vegas Aug 2026", "Punta Cana 2027")

### Phase 2 — Auto-Enrichment
- [ ] **Paste hotel URL** → scrape name, description, amenities, thumbnail (Cheerio/Puppeteer)
- [ ] **Paste YouTube URL** → YouTube Data API v3: fetch title, thumbnail, channel, duration, embed
- [ ] **Google Places API** → star rating, review count, address, photo, website
- [ ] Show enrichment status badge (enriched / manual / failed)

### Phase 3 — Package Links (Best Effort)
- Package sites (Transat, Air Canada Vacations, Sunwing) are heavily anti-bot
- **Approach:** Save URL as a "package link" — user clicks to open in browser
- **Bonus (optional):** Puppeteer with stealth plugin to grab price snapshot at add-time only (not recurring)
- **No live price tracking** — too fragile, not worth it

---

## Data Model

```sql
-- Trips
CREATE TABLE trips (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,           -- "Punta Cana 2027"
  destination TEXT,             -- "Punta Cana, DR"
  travel_dates TEXT,            -- "Mar 1–8, 2027"
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Hotel Candidates
CREATE TABLE hotels (
  id SERIAL PRIMARY KEY,
  trip_id INT REFERENCES trips(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  destination TEXT,
  price_range TEXT,             -- "$180/night" or "$2,400 pp AI"
  status TEXT DEFAULT 'considering', -- considering | eliminated | booked
  my_rating INT CHECK (my_rating BETWEEN 1 AND 5),
  pros TEXT[],
  cons TEXT[],
  notes TEXT,

  -- Links
  hotel_url TEXT,
  package_url TEXT,
  youtube_url TEXT,

  -- Auto-enriched
  thumbnail_url TEXT,
  description TEXT,
  amenities TEXT[],
  google_rating NUMERIC(2,1),
  google_review_count INT,
  youtube_title TEXT,
  youtube_thumbnail TEXT,
  enriched_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Pages & Routes

```
GET  /                        → redirect to /trips
GET  /trips                   → trip list (create new trip)
POST /trips                   → create trip
GET  /trips/:id               → hotel dashboard for a trip
POST /trips/:id/hotels        → add hotel (manual or paste URL)
GET  /hotels/:id              → hotel detail page
PATCH /hotels/:id             → update field (HTMX inline edit)
DELETE /hotels/:id            → delete hotel
POST /hotels/:id/enrich       → trigger auto-enrichment
POST /hotels/:id/status       → toggle status (HTMX)
POST /hotels/:id/rating       → set my_rating (HTMX)
```

---

## UI Layout

### Trip Dashboard (`/trips/:id`)
```
[Trip Name]  Punta Cana 2027 — Mar 1-8
[+ Add Hotel]  [Sort: Rating ▼]

┌─────────────────────────────────────────┐
│ 🏨 Barceló Bávaro Palace        ✅ Booked │
│ ⭐⭐⭐⭐½ (my: ⭐⭐⭐⭐)  ~$2,800 pp AI    │
│ ✓ Beachfront ✓ Huge pools ✓ Kids area  │
│ ✗ Loud at night                         │
│ [🎥 Watch Review] [🌐 Hotel] [✈️ Package]│
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ 🏨 Dreams Onyx                🔵 Consider│
│ ⭐⭐⭐⭐ (my: ⭐⭐⭐)  ~$2,400 pp AI       │
│ ✓ Adults-only section ✓ Good food       │
│ ✗ Smaller beach ✗ Farther from airport  │
│ [🎥 Watch Review] [🌐 Hotel] [✈️ Package]│
└─────────────────────────────────────────┘
```

### Add Hotel Flow (HTMX modal)
```
Paste anything:
[ Hotel URL / YouTube URL / or just type a name ]  [Add]

→ App detects type, enriches, inserts card
→ User fills pros/cons/notes inline
```

---

## Auto-Enrichment Logic

```
User pastes URL
  ├── youtube.com/* → YouTube Data API v3 (title, thumbnail, embed)
  ├── google.com/maps/* → Google Places API (rating, photos, description)
  ├── booking.com / tripadvisor / hotels.com
  │     → Cheerio scrape (name, description, star rating, thumbnail)
  │     → Fallback: Open Graph tags (og:title, og:image, og:description)
  ├── transat / aircanadavacations / sunwing (package sites)
  │     → Save URL only, flag as "package link"
  │     → Optional: Puppeteer stealth one-time price grab
  └── Unknown → Open Graph fallback → manual
```

---

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Server | Express.js | Same as EventGlimpse |
| Views | EJS | Same as EventGlimpse |
| CSS | Pico.css | Same as EventGlimpse |
| Interactivity | HTMX | Inline edits, status toggles without React |
| DB | Postgres | Same as EventGlimpse |
| Scraping | Cheerio (light) + Puppeteer (heavy/package) | Progressive |
| YouTube | YouTube Data API v3 (free tier) | Reliable, structured |
| Places | Google Places API (free tier) | Rating + photo |
| Deploy | Docker on Hetzner (existing server) | Reuse infra |
| Domain | TBD (subdomain of event-glimpse.com or new) | |

---

## Open Questions

1. **Auth?** Solo use — simple admin password like EventGlimpse, or no auth at all?
2. **Mobile?** Pico.css is responsive — should be fine for adding notes on the go
3. **Sharing?** Could share a read-only trip view with travel companions (later)
4. **Domain?** `trips.event-glimpse.com` (reuse server) or standalone `trip-picker.com`?
5. **YouTube API key** — need one (free, 10K req/day is plenty)
6. **Google Places API key** — need one (free tier: $200/month credit)

---

## Risks

| Risk | Mitigation |
|---|---|
| Package sites block scraping | Save URL only; manual price entry as fallback |
| Google Places API cost | $200/month free credit covers personal use easily |
| Cheerio scrapes break on site redesign | Open Graph tags as fallback (more stable) |
| Scope creep | Phase 1 ships without enrichment — just cards |

---

## Project Name Ideas
- **TripPick** — simple, direct
- **HotelStack** — implies comparison
- **VacaPick** — casual
- **ScanVac** — scan your vacation options

---

---

## Rating System (decided June 16, 2026)

### My Ratings — 6 Dimensions
Each rated 1–5 by the user:

| Dimension | Emoji | Notes |
|---|---|---|
| Beach | 🏖️ | Sandy vs rocky, size, cleanliness |
| Property | 🏨 | Buildings, rooms, modern vs dated |
| Food | 🍽️ | Quality, variety, all-inclusive value |
| Pools | 🏊 | Size, vibe, waterpark |
| Location | 📍 | Airport distance, area, walkability |
| Value | 💰 | Price vs what you get |

**Card display:** Thin horizontal bars — compact, scannable. Scores ≤ 2 turn red automatically.

**Edit UX — Bottom Sheet pattern** (decided over drag/slider/inline dots):
- Tap "✏️ Edit Ratings" on card → bottom sheet slides up
- 6 rows, one per dimension
- Each row has 5 large numbered tap targets (40×40px) — comfortable thumb hit
- "Poor ← → Excellent" hint label
- Low rating (1–2) highlights red on selection
- Save / Cancel always visible at bottom
- No drag, no precision required — deliberate one-tap-per-row

### Public Review Intelligence
Pulled automatically (Hermes cron) from TripAdvisor / Google:
- Overall score + review count
- **Pattern tags** extracted from recent comments — grouped as 🟢 praise / 🔴 concerns
- Examples of concern tags: `musty smell A/C`, `rocky beach`, `mold in bathroom`, `outdated rooms`
- **Fake review trust flag** — 3 levels:
  - ✓ Looks genuine (green)
  - ⚠️ Some fake patterns (amber)
  - 🚩 High fake risk (red)

---

## Schema Updates (from design review)

Revised from initial design based on big model review:

```sql
-- Replace travel_dates TEXT with real dates
ALTER TABLE trips ADD COLUMN travel_start DATE;
ALTER TABLE trips ADD COLUMN travel_end DATE;

-- Replace price_range TEXT with structured fields
ALTER TABLE hotels ADD COLUMN price_min INT;  -- in cents
ALTER TABLE hotels ADD COLUMN price_max INT;
ALTER TABLE hotels ADD COLUMN price_currency TEXT DEFAULT 'CAD';
ALTER TABLE hotels ADD COLUMN price_type TEXT DEFAULT 'all_inclusive_pp';
ALTER TABLE hotels ADD COLUMN price_display TEXT; -- human-readable

-- Add place ID for Google Places re-fetch
ALTER TABLE hotels ADD COLUMN google_place_id TEXT;

-- Add sort order for manual ranking
ALTER TABLE hotels ADD COLUMN sort_order INT;

-- Add status constraint
ALTER TABLE hotels ADD CONSTRAINT hotels_status_check
  CHECK (status IN ('considering', 'eliminated', 'booked'));

-- 6-dimension ratings (1-5 each)
ALTER TABLE hotels ADD COLUMN rating_beach INT CHECK (rating_beach BETWEEN 1 AND 5);
ALTER TABLE hotels ADD COLUMN rating_property INT CHECK (rating_property BETWEEN 1 AND 5);
ALTER TABLE hotels ADD COLUMN rating_food INT CHECK (rating_food BETWEEN 1 AND 5);
ALTER TABLE hotels ADD COLUMN rating_pools INT CHECK (rating_pools BETWEEN 1 AND 5);
ALTER TABLE hotels ADD COLUMN rating_location INT CHECK (rating_location BETWEEN 1 AND 5);
ALTER TABLE hotels ADD COLUMN rating_value INT CHECK (rating_value BETWEEN 1 AND 5);

-- Replace denormalized youtube fields with hotel_links table
CREATE TABLE hotel_links (
  id SERIAL PRIMARY KEY,
  hotel_id INT REFERENCES hotels(id) ON DELETE CASCADE,
  link_type TEXT NOT NULL CHECK (link_type IN ('youtube', 'hotel_site', 'package', 'review', 'other')),
  url TEXT NOT NULL,
  title TEXT,
  thumbnail_url TEXT,
  metadata JSONB,
  added_at TIMESTAMPTZ DEFAULT NOW()
);

-- Review intelligence
ALTER TABLE hotels ADD COLUMN review_score NUMERIC(3,1);
ALTER TABLE hotels ADD COLUMN review_count INT;
ALTER TABLE hotels ADD COLUMN review_tags_praise TEXT[];
ALTER TABLE hotels ADD COLUMN review_tags_concerns TEXT[];
ALTER TABLE hotels ADD COLUMN review_trust TEXT CHECK (review_trust IN ('genuine', 'warn', 'suspicious'));
ALTER TABLE hotels ADD COLUMN review_scanned_at TIMESTAMPTZ;

-- Indexes
CREATE INDEX idx_hotels_trip_id ON hotels(trip_id);
CREATE INDEX idx_hotels_status ON hotels(status);
CREATE INDEX idx_trips_travel_start ON trips(travel_start);
CREATE INDEX idx_hotel_links_hotel_id ON hotel_links(hotel_id);
```

---

## Revised Phase Plan (from design review)

**Phase 1 — MVP + Comparison** (2-3 weekends)
- Manual CRUD (trips + hotels)
- 6-dimension rating with bottom sheet UX
- Card grid view + compare table view
- Status toggle (considering/eliminated/booked)
- Basic auth (`express-basic-auth`)

**Phase 1.5 — Hermes Integration** (1 weekend)
- `/api/*` JSON endpoints (GET trips/hotels, PATCH hotel, POST link)
- API key header auth (`X-API-Key`)
- Hermes cron jobs: YouTube monitoring, morning briefing, Google rating refresh

**Phase 2 — In-App Enrichment** (2 weekends)
- OG tag extraction on URL paste
- YouTube Data API v3
- Google Places lookup (rating, photo, place_id)
- Enrichment status badge

**Phase 3 — Polish** (1 weekend)
- Package URL storage + price snapshot attempt
- JSON export/backup
- Read-only trip share view

---

*Updated: 2026-06-16 | Status: Mocks complete, ready for scaffold*
