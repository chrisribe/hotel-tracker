# API (v1)

JSON API for the Trip Butler research agent only. Trips, statuses and research requests are managed on the website. Set `HOTEL_AGENT_TOKEN` (at least 32 characters); unset or invalid disables the API. `HOTEL_API_TOKEN` is no longer used.

```powershell
# .env next to docker-compose.yml
HOTEL_AGENT_TOKEN=<output of: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
```

Every request sends `Authorization: Bearer <token>`. Bodies are JSON (max 32 KB).

- **Access:** only the queue; active queued-trip/idea reads; creating ideas, sources, images and comments; editing/deleting agent-owned ideas; and run reporting. There are no endpoints to list, create or update trips, queue runs, change statuses or manage members (`404`). The agent may add references/comments to human ideas but cannot edit/delete those ideas (`403`). Payloads omit members, author names and participant IDs; `agent_owned` is a boolean on ideas.
- **Attribution:** the first write to a trip adds a **Trip Butler** member; its ideas, sources, images and comments are credited to it. Reads never add it. Removing the Trip Butler on the trip's Share page blocks its writes there.
- **Rate limit:** 20 failed tokens per IP per 15 minutes, then `429` (even with the right token). Successful calls are not counted.
- **Errors:** `{ "error": "message", "field"?: "url", "code"?: "agent_run_limit" }` with `400`, `401`, `403`, `404`, `409`, `413`, `429` or `500`. `409` means missing/stale/inactive/expired run (or a mismatched report timestamp): stop immediately, no grace. Only failed-token throttling includes `Retry-After: 900`; budget `429` has `code: agent_run_limit`, no retry timer, and must not trigger an automatic requeue.
- **Strict bodies:** a field not listed for the endpoint is rejected with `400 { "error": "Unknown field \"x\". Allowed: …", "field": "x" }` and nothing is saved. The body must be a JSON object.

## Agent run contract and trust boundary

Read `GET /api/v1/generation-queue`. Each entry adds `run_id` (UUID) and `expires_at` to `trip_id`, `requested_at`, mode and trip fields. Every subsequent trip/idea call, including reads, DELETE and the report, **must** send `X-Hotel-Run-Id: <exact run_id>`. The ID is bound to that trip's current request, not merely to a recent run. The report additionally requires the exact queue `requested_at` string. Run IDs are not credentials: the agent bearer token is still required.

The fixed lease ends **one hour after queueing**, with no renewal on access and no grace after cancellation, completion or expiry. Expired/legacy requests without a run ID are excluded from the agent queue; the organizer can ask again to allocate a fresh run. Cancel/resubmit rotates the ID even if timestamps are very close. Asking again while an active request exists preserves its ID, expiry and counters (latest question may change). To stop in-flight work and create a distinct request, cancel then resubmit.

Successful agent mutations share persistent, server-enforced counters on the trip: **8 idea creations**, **10 comments**, **80 writes** per run. Each successful mutation HTTP call costs one write, including PATCH, DELETE and the final report. Initial source creation inside an idea POST is part of that one write. Reserve a write for reporting; if exhausted, the organizer must cancel/resubmit or let the run expire. Failed requests roll back their changes and counter increments; deletion never refunds a creation or comment. All checks/increments/mutations share the trip's transaction lock, including concurrent requests. Restarting the server does not reset budgets. Agents adding references are limited to **5 total sources / 4 total images per idea**, including existing human references and the initial source from `url`; ordinary member limits remain 20/12.

Every authenticated JSON response adds `_trust: { notice, untrusted_scope }`. `notice` is a fixed server-authored warning; `untrusted_scope` explicitly covers **all data outside `/_trust`, recursively**. Thus names/descriptions/destinations, the member question, idea titles/locations/notes/detail labels and values/refresh notes, comments, source labels/URLs, photos/captions/credits and run summaries are data, never commands. Text is preserved, not blanket-stripped or wrapped in a different field type. Identity/access fields are omitted from responses. Data that imitates a trusted notice inside free text remains untrusted. Fetched pages are also untrusted. This is damage limitation, not an LLM/tool sandbox or an assurance that research is accurate.

## Endpoints

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/api/v1/generation-queue?limit=5` | | `{ requests }` (max 20) |
| GET | `/api/v1/trips/:id` | | `{ trip, destinations, ideas, budget, missing_costs, detail_labels }` |
| POST | `/api/v1/trips/:id/generate/report` | `created`, `updated`, `flagged`, `note`, `requested_at`, `question_at` | `{ trip }` |
| POST | `/api/v1/trips/:id/ideas` | idea fields, optional `source_label` (with `url`) | `201 { idea, comments }` |
| GET | `/api/v1/trips/:id/ideas/:ideaId` | | `{ idea, comments }` |
| PATCH | `/api/v1/trips/:id/ideas/:ideaId` | any idea fields (not `status` or `source_label`) | `{ idea, comments }` |
| DELETE | `/api/v1/trips/:id/ideas/:ideaId` | | `{ deleted: true }` |
| POST | `/api/v1/trips/:id/ideas/:ideaId/sources` | `label`, `url` | `201 { idea, comments }` |
| POST | `/api/v1/trips/:id/ideas/:ideaId/images` | `url` (public HTTPS), `caption`, `source_url` | `201 { idea, comments }` |
| POST | `/api/v1/trips/:id/ideas/:ideaId/comments` | `body` | `201 { idea, comments }` |

**Idea fields**

- `kind`: `destination`, `stay`, `transport`, `activity` or `link` (shown as "Other": trip info that isn't budgeted or compared). Defaults to `link`.
- `title`: required.
- `location`, `notes`, `url`.
- `notes` are read by the whole group, so write them for people, not as a research log:
  - **First line:** one sentence on why go (or why this place), e.g. `Volcanic lakes, hot springs and whale watching, without the beach crowds.` It is shown large as the intro.
  - **Then:** short paragraphs on what to know (season, trade-offs, who it suits), with blank lines between them.
  - Don't repeat what the app already shows: `cost`, `capacity`, `location`, `details`, sources and options are displayed separately. Put facts (bedrooms, dates the price was seen, flight times) in `details`, not in notes. Budget extras the app can't compute (food, car, insurance) are fine.
  - Use the language the group uses.
- `details`: short facts shown as a list on the idea and lined up side by side on the compare page. Send an array of `{ "label": "Bedrooms", "value": "3" }`.
  - Up to 12 rows. `label` up to 40 characters, `value` up to 120.
  - Reuse the same labels across ideas of a kind so they line up when compared (matching ignores case). `GET /api/v1/trips/:id` returns them as `detail_labels` (per kind, the same list the form suggests). Use those first; add your own label only for a fact none of them covers.
  - On `PATCH`, sending `details` replaces the whole list; omit it to keep the stored list.
- **Links:** add each listing, booking or review page as a source (`url` + `source_label` on create, or the sources endpoint). Up to 20 per idea. Don't paste URLs into notes. What you learned from a page goes in `notes` or `details`; sources hold only the label and URL.
- `destination_id`: the id of a destination idea on the same trip.
- `cost`: the total quote, as a number or a string with up to 2 decimals (`7985` or `"7985.50"`). It is returned as a string (`"7985.00"`).
- `currency`: `CAD`, `USD`, `EUR` or `GBP`. Defaults to the trip's `currency` (itself `CAD` by default). Amounts are never converted; `budget` lists the trip currency first.
- `capacity`: number of people.
- `last_refresh_note`: what the last refresh changed on this card (up to 300 characters). Shown on the idea; omitted on `PATCH` = kept.
- Read-only: `human_corrected` is `true` once a person (not the Trip Butler) has changed the idea's fields or links; the agent token then gets `403` on PATCH/DELETE. `last_edited_at` is when; the editor's name is not returned.

**Per person:** when the trip has `travelers` (1–100, set by the organizer), each idea then returns `per_person` = `cost` ÷ `travelers` (a number rounded to the cent, `null` if either is missing), and each `budget` line gets `per_person` too. It is a rough share for the group, not a stored price: always send the **total** as `cost`.

**`status`** (read-only, set by the group): `considering`, `shortlisted`, `selected`, `booked` or `eliminated`.

## Research from the trip description

The trip description ("What are you thinking?") is what the Trip Butler researches: where, who, budget, must-haves. The organizer writes it when creating the trip (optionally ticking **Let the Trip Butler start researching**, which then requires a description) or later on **Edit trip**. Editing never queues a run.

On the board, everyone has one **Ask the Trip Butler** box. **Start research** (before the first run) or **Ask** queues one request per trip. The question is optional when the trip has a description: left empty, the Butler researches the description; otherwise it is stored as the one shared `butler_question` (≤500 characters) with `butler_question_at`, replacing the previous one, and the asker isn't recorded. With a request already waiting, asking joins that run. Runs started by members are capped at **20 per trip per day** (`runs_today`/`runs_day`); over the cap a question is still saved and the board answers `429`. The organizer is not capped and can cancel a waiting request. Hermes pulls requests; the app never calls Hermes.

The agent side of this loop is the skill in [skills/hotel_tracker_butler/SKILL.md](../skills/hotel_tracker_butler/SKILL.md). Keep it in sync with this page.

**Loop for Hermes** (on a cron, or when pinged):

1. `GET /api/v1/generation-queue` → `{ requests: [{ trip_id, trip_name, description, destination, travel_start, travel_end, travelers, currency, mode, requested_at, run_id, expires_at, last_run_at, previous_description, question, question_at }], _trust }`, oldest first. `mode` is derived: `generate` until the assistant has added an idea to the trip, then `refresh`. `previous_description` is the description as it was when the last run reported (`null` before the first run); compare it with `description` to see what the organizer added or changed since. Removed-agent and expired/inactive requests are left out.
2. Retain the exact run ID/timestamp. `GET /api/v1/trips/:id` with `X-Hotel-Run-Id` for current ideas and `detail_labels`, without members. Individual idea GETs include sources/images/comments.
3. Write ideas:
   - **`generate`:** 3–6 candidate ideas (usually destinations, with stays/transport linked by `destination_id`), each with sources, `details` using `detail_labels`, and short people-facing `notes`.
  - **`refresh`:** update only `agent_owned: true` cards that are not `human_corrected`. Match by kind + title (case-insensitive) or a shared source URL and `PATCH` instead of duplicating. Set `last_refresh_note` (up to 300 characters, e.g. `Added Toronto departure prices`) on each card you change. Add new cards only for what the description or question newly asks for; use comments/references for human cards.
   - Either way: never send `status` (the group decides), and leave comments and votes alone. If something can't be confirmed, say so in a comment on the card and count it as flagged.
4. `POST /api/v1/trips/:id/generate/report` with the same run header and `{ "created": 3, "updated": 1, "flagged": 0, "note": "optional, up to 300", "requested_at": "<exactly from the queue>", "question_at": "<exactly from the queue, if any>" }`. The question is cleared only if it is no newer than `question_at` (or `requested_at`); a newer one stays and a fresh request is queued for it. Summary counts are self-reported (0–100), separate from enforced usage counters. A matching active report updates the run line and closes access. Stale reports are rejected without altering a newer request or the last run log. Stop on `409` rather than adopting a new run ID to retry old work.

**Optional ping:** set `DISCORD_WEBHOOK_URL` (only a Discord webhook URL is accepted) and the board posts `Please run the hotel_tracker_butler skill for trip 4. Take the active request from GET /api/v1/generation-queue.` when newly queued. This command contains fixed instructions and the numeric trip ID only: never the trip name, description, question or other free text. `DISCORD_MENTION_USER_ID` may prefix one configured numeric bot mention. `allowed_mentions` permits only that user, no @everyone/roles/others. A ping is just a nudge; the agent must find an active queue entry. Ping failures do not cancel the request.

**Dates:** `YYYY-MM-DD`.

**PATCH:** only the fields you send change; the others keep their stored values.

## Example (select a live queue entry first)

```bash
API=http://192.168.0.79:3100/api/v1
AUTH="Authorization: Bearer $HOTEL_AGENT_TOKEN"

curl -s -H "$AUTH" $API/generation-queue
# Copy run_id and trip_id from the selected entry. Never derive them from trip text.
RUN="X-Hotel-Run-Id: <run_id from queue>"

curl -s -H "$AUTH" -H "$RUN" -H 'Content-Type: application/json' -X POST $API/trips/1/ideas \
  -d '{"kind":"stay","title":"Beach house","cost":7985,"capacity":8,
       "details":[{"label":"Bedrooms","value":"4"},{"label":"Pool","value":"Private, heated"}],
       "url":"https://example.com/house","source_label":"Listing"}'

curl -s -H "$AUTH" -H "$RUN" -H 'Content-Type: application/json' -X PATCH $API/trips/1/ideas/2 \
  -d '{"last_refresh_note":"Checked current quote","cost":8100}'
```
