# Group trip research

Mode: Operate. Targets: server/views/planner-shell.ejs, server/views/planner/, server/static/css/planner.css.

## Direction contract

THESIS: A shared research board leads with the group's actual options, not a marketing hero or a hotel-only list. Each option card displays associated sources (up to 20 labeled per card with takeaways) and images (up to 12 external HTTPS references with captions and attribution). The existing app's warm ground, teal action color, and dark navigation remain recognizable.

OWN-WORLD: Warm off-white canvas, deep green navigation, white working surfaces, dark ink, restrained amber decision states. Workhorse sans-serif text and clean heading hierarchy; rounded controls, generous grouping, no ornamental metrics.

STORY: Open the trip, see what's undecided, filter research by kind or destination, contribute an idea with sources and images, compare 2–4 same-kind options side-by-side, and express interest or comment. Private joining asks only for a name. Selected/booked status tracks the organizer's final choices in a separate view.

FIRST VIEWPORT: A narrow navigation rail contains My trips, Research, and Selected plan. The board opens directly with the trip title, add action, and compact context, without a duplicate breadcrumb or summary rail. Category links and Compare lead into three card columns on wide screens, two at intermediate widths, and one on phones. Search/status/destination filters and the people list use native disclosures. Mobile navigation and content stay in normal flow.

FORM: Extension of the existing trip dashboard; inherited world, no replacement identity or concept seed required. This uses new-work's "Extend an existing surface" exception rather than the new/replacement-world tournament. No seed was run and none is claimed retrospectively. Signature interaction: each idea's interest control, visible contributor, and curated sources/images make research feel shared; comparing options and selecting them builds a separate estimated plan without counting alternatives.

SOURCES & IMAGES: Source pages accept HTTP(S); image references require HTTPS and reject obvious local/private IP literals without DNS verification. No server proxying or uploads. External image hosts see viewers' IP and may block/expire references. Image referrer policy `no-referrer`. Any trip member contributes; source/image authors and organizers edit/remove; idea author/organizer sets cover.

FINISH: unreviewed and undocumented is unfinished; this build ends with the frontend finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## Constraints

Optional sources and images per option (up to 20 sources with takeaways, 12 images with optional attribution and a cover). Clearly labeled optional sample trip. Native links/forms work without JavaScript; progressive script adds clipboard, comparison guidance, broken-image fallback, and form affordances. Preserve legacy hotel records and routes behind organizer access. No sensitive booking documents. Comparison and selected-plan views are separate. No server proxying, uploads, or live pricing.

## Review evidence

### UX simplification (2026-10-13)

User requested a simpler experience after accepting V1. Preserve cards, sources/photos, collaboration, comparison, and selected-only estimates; remove duplicated controls and instructions rather than capabilities.

- Permanent navigation reduced from six links to three. Compare stays next to research; people/invite controls stay in the board header. Shortlist is a status filter, not a competing workspace.
- Removed the board’s duplicate budget/crew/tip rail; the selected-plan page is the estimate’s home. Member names remain available in the compact people disclosure; original hotel records retain an inline entry point.
- Creation starts with type, name, and optional URL. Source annotations, location/notes, and quote/capacity are optional disclosures. Populated edits and validation errors reveal their fields. No hidden values are discarded.
- Idea detail has one overview and a linear sources/photos/discussion flow instead of a secondary sidebar. Contribution forms start closed, including empty collections, and reopen only for the matching validation error.
- Comparison opens all available options automatically only when the category contains 2–4. Larger sets require explicit choices; specified IDs retain their order and validation. No option status changes on GET. Irrelevant all-empty destination quote/capacity rows are omitted.
- Selected plan shows one estimate, required warnings, and selected rows. Removed repeated status diagrams and research counts; booking cautions remain explicit.

Verification: 20 integration tests pass with real EJS. Desktop1440/mobile390 captures cover board, creation, collection, comparison, and selected plan; tablet900 comparison also fits. No document overflow or failed photos. Browser tests cover shortlist filtering, validation-value retention with only the matching form open, and native no-JavaScript comparison/disclosures. Navigation links halved; initially visible editor controls halved (14 to 7 counting five radio inputs). Desktop cards begin around470px rather than585px. Current captures are `simplify-*-desktop.png` / `simplify-*-mobile.png`; the older captures below are historical.

Independent review requested one error-recovery correction. Error notices now link directly to the matching invalid source/photo field, with an associated inline message and `aria-invalid`; add/edit values and disclosure state remain intact. Desktop/mobile and no-JavaScript browser checks confirmed focus reaches the field. The verdict scored this fix resolved and returned `ship` for the scored fix, not a fresh whole-surface review. Documentation verification confirmed the inherited core system remains intact; baseline catalogue drift was reported without rewriting DESIGN.md or its sidecar.

### Earlier iteration evidence

First draft (Iteration 1): desktop research board at 1440px, mobile board and guest discussion at 390px. Valid full-page screenshots, no overflow. Ten database-backed integration tests pass with real EJS rendering. Live guest join/create/edit/vote/comment and organizer selection verified. Detector returned no findings. Placeholder contrast corrected; DM Sans now self-hosted with its license.

Second iteration (2026-10-13): up to 20 sources with takeaways and 12 image references per option, comparison view, and separate selected-plan totals. Eighteen database-backed integration tests pass with real EJS rendering and no skips, including collection ownership/limits, cover replacement, comparison scoping, selected-only budgets, and one-time legacy research-URL imports.

Browser evidence: board, collection, comparison, selected plan, and editor captured at 1440px and 390px; comparison also checked at 900px and without JavaScript. All returned HTTP 200 with no page overflow or page errors. Real external demo photos loaded; a deliberately aborted request verified the fallback. Guest source creation/editing persisted; temporary verification contributions and participant were removed. Selected-house CAD 1,800 excludes the shortlisted car; deselection removes the quote; an unpriced selected activity is explicitly missing cost.

The one manual detector finding (thick warning accent border) was corrected to a uniform border. Independent finish review matched the inherited-world contract and requested one SVG disclosure fix. Corrected captures were scored resolved, with `ship` covering that fix rather than a fresh whole-surface review. The documenter verified preservation of the inherited system.

### Local additions and baseline scope

DESIGN.md and its sidecar remain the iteration-one normative baseline for core palette, typography, and working-surface patterns. This extension adds a selected status tint, source entries, reference-photo gallery/fallback, horizontal comparison table, selected-plan rows, and SVG disclosure rotation. The baseline’s no-raster wording and exhaustive status/component lists do not describe these new reference-photo and local-component capabilities; they were reported without an unrequested system rewrite. Disabled controls now use a not-allowed cursor; only busy controls use wait. Current product semantics and verification evidence are recorded here and in PRODUCT.md/README.md.