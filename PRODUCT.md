# Hotel Tracker

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

A small, trusted travel group researching a trip together, plus an organizer who manages access and final selections.

## Product Purpose

Collect destination ideas, places to stay, transport options, links, quotes, discussion, sources, and images before deciding where to go. Turn shared research into a shortlist and later into a booked trip.

## Operating Context

Participants join using a private invite link and a display name, not individual passwords. Names attribute contributions but are not verified identities. Browser sessions remember participants. The organizer retains password-protected controls. Desktop and mobile browsers are both important.

## Capabilities and Constraints

- Express/EJS/PostgreSQL application with Docker Compose deployment. Greenfield: no legacy data or routes to preserve.
- Destination and travel dates may remain undecided while research accumulates.
- Accommodation includes hotels and vacation rentals; rental cars also belong in the research.
- Private trip membership must be checked on every read and write.
- Do not store payment details, passports, or other sensitive travel documents in this first draft.
- Manual links, quotes, sources, and images come before scraping, live prices, or booking integrations.
- User approved a working first draft and delegated remaining decisions after an explicit confirmation probe.

## First-draft assumptions

- All participants can contribute ideas, sources, images, comments, and votes, correct any idea that isn't selected or booked (the last editor is shown, no history), and ask the Trip Butler (one shared question, or just "research the trip"). Organizers manage invitations, participants, final selections, and the trip details, including the description the Trip Butler researches.
- Currency totals remain separate; research alternatives are not automatically summed as expenses.
- A sample trip is available by explicit organizer action and clearly labeled fictional; never silently populate existing trips.
- Branding remains Hotel Tracker during this draft; the new capability is group trip planning.

## Second Iteration Facts

**Research Structure:**
- Each destination, accommodation, transport, activity, or useful-link option is one card—not one card per supporting URL.
- Each card may reference up to 20 labeled sources (articles, reviews, websites); what they say goes in the card's notes.
- Each card may include up to 12 external HTTPS image references, with optional captions and source attribution; one image is the cover.
- **Permissions Model:** Any active trip member may add ideas, sources, and images; source/image authors or organizers may edit or remove their references; the idea author or organizer designates the cover image.

**Source & Image Handling:**
- Source pages accept HTTP(S); image references require HTTPS and reject obvious localhost/private IP literals, without DNS verification. No server-side proxying, upload endpoints, or image fetching. External image hosts receive viewers' IP and can block/expire references. Image referrer policy is `no-referrer`.

**Comparison & Selection:**
- Compare 2–4 same-kind same-trip options via `/plans/:id/compare` (e.g., hotels, rental agencies, tours).
- Separate selected-plan view (`/plans/:id/selected`) contains selected/booked options; the shortlist remains for comparing alternatives.
- Selected/booked status records the organizer's final choice; only recorded quotes for stays, transport, and activities are totaled by currency.
- Missing-cost and alternatives warnings alert before booking.
- No booking automation; the organizer records the decision in this app, while reservations happen externally.

**Testing & Shipping:**
- Twenty database-backed integration tests pass with real EJS rendering and no skips. Desktop/mobile board, collection, comparison, selected plan, and editor returned HTTP 200 with no page overflow or JavaScript errors; tablet and no-JavaScript comparison were checked. Guest source contributions, selected-only totals, deselection, missing-cost messaging, and a controlled broken-image fallback were exercised.
- Independent review found one SVG disclosure consistency issue; corrected and scored resolved, with a ship verdict limited to that fix. Inherited design-system verification completed without rewriting its baseline files.

## Evidence on Hand

The existing hotel shortlist application and visual styling, plus both iterations’ implementation and browser captures. No verified destination quotes or group travel content was supplied. Demonstration entries are clearly labeled as examples; external mood photos are explicitly not photos of the fictional destinations.

## Product Principles

- Research before commitment.
- Make contributing as easy as sharing a link.
- Preserve attribution and trip privacy.
- Separate estimates, preferences, and bookings.
- Keep research primary: three navigation links, optional fields on demand, no duplicate summary rail. Comparison and contribution are tools within research, not additional workspaces.

## Current UX simplification

The user accepted V1, then requested reduced complexity. No capabilities were removed: sources/photos, filters, membership controls, comparison, and selection remain. Creation now starts with type/name/optional URL; native disclosures hold optional details and preserve values. Small comparison sets (2–4) open directly without mutating statuses; larger sets still require a choice. The selected plan owns the estimate. Twenty integration tests and desktop/mobile browser checks verify these changes. Error-only correction links jump to the invalid field with an associated message, including without JavaScript. Independent review’s error-recovery finding was resolved; design-system continuity was verified without an unrequested baseline rewrite.

## Open decisions

Account recovery across devices, verified identities, expense settlement, booking integrations, and production hosting configuration remain future work.