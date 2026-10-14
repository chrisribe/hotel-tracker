# Hotel Tracker

A private group-trip research workspace: collect destinations, places to stay, rental cars, activities, and useful links before deciding where to go.

**Stack:** Express 4, EJS, PostgreSQL, Docker Compose. Native HTML forms with progressive JavaScript.

## Run with Docker Compose

From the repository root, run `docker compose up -d --build`, then open **http://localhost:3100**. Schema setup and additive migrations run automatically before the server accepts requests. PostgreSQL data and browser sessions persist in the named Docker volume. Do not remove the volume unless you intend to erase the data.

Organizer credentials default to **admin / changeme** for local development. Set `ADMIN_USER` and `ADMIN_PASS` in the Compose environment before exposing this app outside your machine. The new sign-in page is at `/login`.

## Core planner

- Create a trip with an optional destination, description, and dates.
- Open **Sample trip** from the trip list to create a clearly labeled fictional research workspace. It is separate from existing trips and is not created automatically.
- Add destination ideas, accommodation, transport, activities, and links. Associate options with a destination, record a total quote and currency, and add practical notes.
- Filter by type, destination, search text, or shortlist; review selected/booked options in the separate plan.
- Share a private invite link. A companion enters a name; their PostgreSQL-backed browser session remembers membership for up to seven days.
- Members add ideas, edit/delete their own ideas, vote, and comment. Organizers manage selections, invitations, and access.
- Selected stays, transport, and activities form an estimated total per currency. Unknown quotes are reported separately. This is not a settlement ledger; it does not convert currencies or divide costs by travelers.

## Simple workflow

1. **Research:** add one card per option. Add sources and photos inside it. Search, status, and destination filters open when needed.
2. **Compare:** open Compare from the board or an idea. Categories with 2–4 options open side by side immediately; larger sets ask you to choose. This never selects a plan for you.
3. **Selected plan:** the organizer selects the group’s choices. Review estimates and missing quotes here; shortlisted alternatives stay out of the total.

The board header holds people/invite controls. Optional idea details stay collapsed until needed; populated edits and validation errors reveal the relevant fields. All core flows work without JavaScript.

## Research collections and decisions

**Research Organization:**
- Each option (destination, stay, transport, activity, or useful link) is one card with associated sources and images.
- Up to 20 labeled sources per option, each with key takeaways from the article/resource.
- Up to 12 external HTTPS image references per option with captions, source attribution, and cover designation.
- **Permissions:** Any active trip member may contribute ideas, sources, and images. Source/image authors or the organizer may edit/remove their contributions. The idea author or organizer sets the cover image.

**Source & Image Handling:**
- Source pages accept HTTP or HTTPS. Image references require HTTPS and reject obvious localhost/private IP literals; hostnames are not DNS-verified. No server-side fetching, proxy, or upload endpoints. External image hosts see viewers' IP and can block/expire references; images use `referrerpolicy="no-referrer"`.

**Comparison & Selection:**
- Compare 2–4 same-kind same-trip options via `/plans/:id/compare` (e.g., multiple hotels, rental cars, or tour operators for the same trip).
- Separate `/plans/:id/selected` page: shortlist means the group is still comparing; only selected/booked options belong in the plan. Selection is reversible and does not create a reservation.
- Only stays, transport, and activity recorded quotes are summed by currency.
- Missing-cost warnings and alternatives warnings highlight incomplete research before booking.
- No booking automation—organizer decision is recorded; actual reservations remain external.

**Testing & Operations:**
- Twenty-two database-backed integration tests cover schema setup, sessions, permissions, invite revocation, comparison views, source/image lifecycle, simplified forms and the JSON API, using real EJS rendering.

## Assistant API

A bearer-token JSON API at `/api/v1` lets an assistant such as Hermes add research. It is off unless `HOTEL_API_TOKEN` is set. See [docs/api.md](docs/api.md).

## Sharing and privacy

Invite links grant access to one trip. Names are display identities, not verified accounts. Anyone who receives a forwarded invite can join, so use this with a trusted group and do not store passports, payment information, or sensitive booking documents.

Replacing an invite stops new joins through the old link. Removing a participant revokes their current session, without deleting their contributions. **Also rotate the invite if someone removed is no longer trusted:** they could otherwise clear cookies and join again.

A guest session currently belongs to one trip. Sign out before joining a different group; there is no cross-device identity recovery yet.

**Localhost links work only on your computer.** For real group access, deploy behind HTTPS at an address the group can reach. Set `COOKIE_SECURE=true` and, only behind a trusted single reverse proxy, `TRUST_PROXY=1` in the server environment. A persistent `SESSION_SECRET` may be supplied; otherwise one is generated and stored in PostgreSQL. Do not publish the default credentials or expose the PostgreSQL port publicly. Compose's local port bindings are development defaults, not a hardened public deployment.

## Verification

Run `npm test` from `server` while the Compose database is running. Tests use a unique temporary PostgreSQL schema and remove it afterward; they never clear the application schema. Set `TEST_DATABASE_URL` to use another test database. The suite covers schema setup, persistent sessions, guest scoping, CSRF/origin checks, input validation, author permissions, votes/comments, selections, invite revocation, and real EJS rendering.

## Deliberately not in this draft

Live pricing/scraping, real booking integration, file uploads, verified accounts, cross-device recovery, per-person expense settlement, and automatic exchange rates. URLs and quotes are entered manually. “Booked” records an organizer's decision; it does not make a reservation.

## Project context

- [Product](PRODUCT.md) — group planning scope and constraints
- [Design](DESIGN.md) — visual direction
- [Original design notes](docs/design.md) — historical hotel-focused plan, not the new implementation contract
