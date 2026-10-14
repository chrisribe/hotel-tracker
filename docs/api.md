# API (v1)

JSON API for assistants such as Hermes. Off unless `HOTEL_API_TOKEN` is set (at least 32 characters).

```powershell
# .env next to docker-compose.yml
HOTEL_API_TOKEN=<output of: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
```

Every request sends `Authorization: Bearer <token>`. Bodies are JSON (max 32 KB).

- **Access:** organizer-level, on every trip.
- **Attribution:** the first write to a trip adds a **Hermes** member; its ideas, sources, images and comments are credited to it. Reads never add it. Removing Hermes on the trip's Share page blocks its writes there.
- **Rate limit:** 20 failed tokens per IP per 15 minutes, then `429` (even with the right token). Successful calls are not counted.
- **Errors:** `{ "error": "message", "field"?: "url" }` with `400`, `401`, `403`, `404`, `413`, `429` or `500`.
- **Strict bodies:** a field not listed for the endpoint is rejected with `400 { "error": "Unknown field \"x\". Allowed: …", "field": "x" }` and nothing is saved. The body must be a JSON object.

## Endpoints

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/api/v1/trips` | | `{ trips }` |
| POST | `/api/v1/trips` | `name`, `description`, `destination`, `travel_start`, `travel_end`, `currency`, `travelers` | `201 { trip }` |
| GET | `/api/v1/trips/:id` | | `{ trip, members, destinations, ideas, budget, missing_costs }` |
| PATCH | `/api/v1/trips/:id` | any of the trip fields above | `{ trip }` |
| POST | `/api/v1/trips/:id/ideas` | idea fields, optional `source_label`, `takeaway` (with `url`) | `201 { idea, comments }` |
| GET | `/api/v1/trips/:id/ideas/:ideaId` | | `{ idea, comments }` |
| PATCH | `/api/v1/trips/:id/ideas/:ideaId` | any idea fields, `status` (not `source_label`/`takeaway`) | `{ idea, comments }` |
| DELETE | `/api/v1/trips/:id/ideas/:ideaId` | | `{ deleted: true }` |
| POST | `/api/v1/trips/:id/ideas/:ideaId/sources` | `label`, `url`, `takeaway` | `201 { idea, comments }` |
| POST | `/api/v1/trips/:id/ideas/:ideaId/images` | `url` (public HTTPS), `caption`, `source_url` | `201 { idea, comments }` |
| POST | `/api/v1/trips/:id/ideas/:ideaId/comments` | `body` | `201 { idea, comments }` |

**Idea fields**

- `kind`: `destination`, `stay`, `transport`, `activity` or `link`. Defaults to `link`.
- `title`: required.
- `location`, `notes`, `url`.
- `notes` are read by the whole group, so write them for people, not as a research log:
  - **First line:** one sentence on why go (or why this place), e.g. `Volcanic lakes, hot springs and whale watching, without the beach crowds.` It is shown large as the intro.
  - **Then:** short paragraphs on what to know (season, trade-offs, who it suits), with blank lines between them.
  - Don't repeat what the app already shows: `cost`, `capacity`, `location`, sources and options are displayed separately. Budget extras the app can't compute (food, car, insurance) are fine.
  - Use the language the group uses.
- `destination_id`: the id of a destination idea on the same trip.
- `cost`: the total quote, as a number or a string with up to 2 decimals (`7985` or `"7985.50"`). It is returned as a string (`"7985.00"`).
- `currency`: `CAD`, `USD`, `EUR` or `GBP`. Defaults to the trip's `currency` (itself `CAD` by default). Amounts are never converted; `budget` lists the trip currency first.
- `capacity`: number of people.

**Per person:** set the trip's `travelers` (1–100, or `null`). Each idea then returns `per_person` = `cost` ÷ `travelers` (a number rounded to the cent, `null` if either is missing), and each `budget` line gets `per_person` too. It is a rough share for the group, not a stored price: always send the **total** as `cost`.

**`status`:** `considering`, `shortlisted`, `selected`, `booked` or `eliminated`.

**Dates:** `YYYY-MM-DD`.

**PATCH:** only the fields you send change; the others keep their stored values.

## Example

```bash
API=http://192.168.0.79:3100/api/v1
AUTH="Authorization: Bearer $HOTEL_API_TOKEN"

curl -s -H "$AUTH" $API/trips

curl -s -H "$AUTH" -H 'Content-Type: application/json' -X POST $API/trips/1/ideas \
  -d '{"kind":"stay","title":"Beach house","cost":7985,"capacity":8,
       "url":"https://example.com/house","source_label":"Listing","takeaway":"Sleeps eight"}'

curl -s -H "$AUTH" -H 'Content-Type: application/json' -X PATCH $API/trips/1/ideas/2 \
  -d '{"status":"shortlisted"}'
```
