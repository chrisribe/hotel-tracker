# Plan: trip members plan together

Status: **implemented, uncommitted** (see [Current state](#current-state)).

## Why

Today the invite experience frames invitees as guests reacting to an organizer:

- They can add their own ideas, links, photos and comments, and shortlist.
- They cannot fix anything someone else added, including the Trip Butler's research. A wrong price or a stale link can only be pointed out in a comment.
- Only the organizer can ask the Trip Butler to look into something.
- The copy ("Travel companion", "Your organizer selects the final plan") says *watch*, not *help*.

The group ends up waiting on one person to research, correct and re-ask. That person becomes the bottleneck, and members have little reason to come back.

## Premise

Invitees are **trip members** who plan together. The organizer keeps two jobs:

1. **Access**: invites, link rotation, removing members.
2. **Recording decisions**: marking options selected, booked or passed on.

Researching, correcting and asking the Trip Butler belong to everyone.

## Who can do what

| Action | Member | Organizer | Trip Butler (agent token) |
|---|---|---|---|
| Add ideas, links, photos, comments | Yes | Yes | Yes (existing per-run caps, unchanged) |
| Correct any idea's details | **Yes, new** ("Edited by" shown) | Yes | Only its own ideas, and only until a person corrects them |
| Correct a *selected* or *booked* idea | No: comment or add an alternative | Yes | No |
| Delete an idea | Own ideas only (unchanged) | Yes | Own ideas only, while uncorrected |
| Edit or delete someone else's link or photo | No (unchanged) | Yes | No |
| Interest votes, shortlist ↔ exploring | Yes (unchanged) | Yes | No |
| Selected / booked / passed on | No (unchanged) | Yes | No |
| Edit the trip description for the Butler | No | Yes | No |
| **Ask the Trip Butler to check something** | **Yes, new** (one shared question) | Yes | — |
| Invites, removals, link rotation | No | Yes | No |

What stays protected:

- **Deletes** remain author-or-organizer. A bad correction can be fixed by editing again; a delete can't be undone.
- **Final decisions** remain with the organizer, so the selected plan and its budget don't shift under people.
- **Links and photos** keep per-contributor ownership. Members fix a bad link by adding a correct one and commenting. This keeps attribution meaningful and the change small.

## 1. Shared corrections

No revision history. Groups are small (typically 4–6 people), and most members read and make the odd fix, so overwrites should be rare. Showing who edited last is enough; a wrong correction gets corrected again or discussed in comments.

### Behaviour
- Every member sees **Correct details** on an idea; it opens the existing edit form.
- For a non-author, the form says: "Your change is saved with your name."
- The idea page keeps "Added by X · date" and adds "Edited by Y · date". Saving with no changes leaves it as is.
- Selected and booked ideas: members see a short note ("The organizer has recorded this in the plan. Comment or add an alternative instead.") in place of the edit action.

### Trip Butler interaction
- Once a person has edited one of the Butler's ideas, the Butler may no longer change or delete it. Agent JSON exposes `human_corrected: true` and the API refuses the PATCH.
- This stops the next run from silently reverting a member's correction. The skill tells the Butler to comment or add a separate alternative instead.

### Data
- `research_items.last_edited_by` (participant, nullable) and `last_edited_at`. Nothing else.

## 2. Members can ask the Trip Butler

One open question per trip. It's a shared slot, not a queue.

### Behaviour
- The board shows everyone one **"Ask the Trip Butler"** box: one optional text field (≤ 500 characters), button **Start research** before the first run, **Ask** after it. The trip description (written at creation or on **Edit trip**, organizer only) is the standing context; there is no separate brief.
- If a question is already waiting, the field is prefilled with it, so a member edits or replaces it rather than stacking another.
- With a description, the field may be left empty: the Butler then researches the description. Without one, a question is required.
- Saving queues a run through the existing queue. If a run is already waiting, nothing new is queued and no new ping is sent. Editing the trip never queues a run.
- When the run reports, the question is cleared and the field is empty again.
- To ask about one idea, members name it in the text (no idea link in this version).

### Limits
**20 member-started Butler runs per trip per day.** Only a member's ask that starts a new run counts (including Start research); joining a waiting run doesn't. The organizer is unlimited. Over the cap, the board says "The Trip Butler has done 20 checks today. Your question is saved; ask again tomorrow." The question stays in the slot.

The existing one-waiting-run-per-trip rule and per-run write caps stay.

### Trip Butler side
- `GET /generation-queue` includes the trip `description`, dates, `travelers`, `currency` and `question` (text or null). **No name.** `mode` is derived: `generate` until the Butler has added an idea, then `refresh`.
- Covered by the existing `_trust` notice: untrusted member text, research hints only, never instructions.
- On report, the question is cleared only if it was asked before this run was requested. A question changed mid-run stays, and another run is queued for it.
- The Discord ping is unchanged.

### Data
- `trips.butler_question` (text ≤ 500, nullable).
- `trips.butler_question_at` (timestamp), so a question edited mid-run isn't erased by the report.
- `trips.runs_day` (date) and `trips.runs_today` (int). The counter resets when the date changes; it goes up when a member's question creates a new run ID.

## 3. Copy and discoverability

Kept modest; uses the existing styles.

- "Travel companion" → **"Trip member"**; "guest" → "member" wherever users see it.
- **Join page**: "Add places, prices and links, fix anything that's out of date, and ask the Trip Butler to look into things. The organizer handles invites and records the final plan." The existing privacy and unverified-name notes stay.
- **Idea page**, quiet member actions: *Correct details* · *Add an alternative* (same kind and destination, prefilled).
- **Shortlist hint**: "Shortlist what you'd pick. The organizer records the final plan."
- **Board Butler box**: "Ask the Trip Butler" for everyone; the description shows in the board header.
- **PRODUCT.md / README**: restate the premise and the table above.

## Risks and how they're handled

| Risk | Mitigation |
|---|---|
| A member overwrites good information | Rare in small groups; "Edited by" shows who, so it can be fixed or discussed |
| Edit wars | Not expected at 4–6 people; the organizer can remove a member if needed |
| Names aren't verified | Unchanged: trusted-group model. Attribution is a courtesy, not proof |
| Members drive agent cost | 20 member-started runs per trip per day; one waiting run per trip; existing per-run write caps |
| A member overwrites another's question | Accepted: one shared slot, like a whiteboard |
| Prompt injection via questions | Same as the brief: untrusted data, restricted agent token, run-bound writes, caps |
| Butler reverts a correction | `human_corrected` lock on agent edits |
| Changing a selected or booked option | Organizer-only |

## Tests to add

- Non-author member corrects an idea → saved, "Edited by" shown; a no-change save keeps the previous editor.
- Member cannot correct a selected or booked idea; organizer can.
- Delete is still author-or-organizer only.
- Member question queues a refresh, prefills the board field and appears in agent payloads; report clears it.
- Question changed mid-run survives the report and queues another refresh.
- Question allowed with no description; asking while a run is waiting reuses that run and keeps its write budget.
- 21st member-started run in a day is refused (question kept); the organizer is not limited; counter resets the next day.
- Agent cannot PATCH a human-corrected idea; can PATCH an uncorrected one; JSON includes `human_corrected`.
- Join page and sidebar copy.
- CSRF on the new question POST route.

## Current state

Implemented, uncommitted. All 41 tests pass, including the cases above.

| Area | State |
|---|---|
| Schema: `last_edited_by/at`, question slot, daily run counter | Done ([init-db.js](../server/scripts/init-db.js)) |
| `IdeasDAO` editor join; `TripsDAO` question slot and counter | Done |
| Revisions/follow-ups tables and DAOs from the earlier design | Removed (an already-migrated dev database may still hold the empty tables) |
| Routes: post question; restore route removed | Done ([planner.js](../server/routes/planner.js)) |
| Service logic (edit permission, question, daily cap) | Done ([PlannerService.js](../server/services/PlannerService.js)) |
| Agent API: `human_corrected`, `question`, redaction, PATCH refusal | Done and tested |
| Views and copy | Done (board, idea, idea form, join, share, shell) |
| SKILL.md, docs/api.md, PRODUCT.md, README | Done |
| New tests | Done |


## Decided

- Question slot: two columns (`butler_question`, `butler_question_at`).
- No revision history: "Edited by" only.
- Agent cost: 20 member-started Butler runs per trip per day; the organizer is unlimited.
- The board doesn't show who asked the current question.
- Selected and booked ideas: only the organizer can correct them.
- Ship all three parts together.

- Links and photos keep per-contributor ownership.
- Questions are allowed before the organizer describes the trip.

## Out of scope

Verified accounts and recovery, co-organizers, notifications or email, revision history and undo, per-field locking, merging of conflicting edits, member edits to the trip description.
