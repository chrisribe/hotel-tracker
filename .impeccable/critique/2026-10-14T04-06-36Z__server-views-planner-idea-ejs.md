---
target: destination page + board (desktop)
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:F:\\CRibe\\GitRepos\\DockerProjects\\hotel-tracker\\server\\views\\planner\\idea.ejs"
target_fingerprint: "sha256:1faac95ef5d70f007380b81e72e5e309125c965aa21bf5edb1acdf55cec75a0a"
target_path: "F:\\CRibe\\GitRepos\\DockerProjects\\hotel-tracker\\server\\views\\planner\\idea.ejs"
timestamp: 2026-10-14T04-06-36Z
slug: server-views-planner-idea-ejs
---
Method: dual-agent (A: design review · B: detector + browser). Scope: desktop only (user request).

## Design Health Score: 24/40 (Acceptable)

| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of system status | 3 | Combo total updates via full reload and jumps to #combo |
| 2 | Match system / real world | 2 | "Combo", "From", "Split for"; ≈$1,071/person vs notes' 2,400–3,300 |
| 3 | User control & freedom | 2 | "Make this the plan" silently demotes other selections; confirm() only |
| 4 | Consistency & standards | 2 | 3 phrasings for missing cost; currency autosaves, split needs Save; "2 people" vs "Split for 6" |
| 5 | Error prevention | 2 | Board "From" mixes stay-only with stay+transport |
| 6 | Recognition over recall | 3 | Original quote currency only in title tooltip |
| 7 | Flexibility & efficiency | 3 | Shareable links, compare one click away |
| 8 | Aesthetic & minimalist | 1 | Each price shown 2–3×, per-person 8+× on one page |
| 9 | Error recovery | 3 | Clear "incomplete"/"left out" messages |
| 10 | Help & documentation | 3 | Honest fine print, but every section explains itself |

## Design Specificity
Core world (forest rail, warm ground, kind icons, honest copy) is authored. The new money layer (combo form, rollup, per-row per-person, header controls) is generic spreadsheet-on-top and revives the duplicate summary PRODUCT.md removed. Detector CLI: 0 findings. Browser: undersized text 10.88px from --fs-2xs (badges, rollup dt, brand sub); low-contrast 4.47:1 on selected empty state; cream-palette = documented token (false positive).

## Priority Issues
- [P1] Two money summaries with identical numbers (rollup "From" = default combo total; option prices listed twice). Fix: one list; combo as row checkboxes or details under Options; per-person on totals only. /impeccable distill
- [P1] Misleading numbers: "2 people" vs "Split for 6"; stay-only "From" ranked with stay+transport; per-person omits unquoted flights. Fix: "2 joined" / "6 travelers"; no headline From when transport unquoted; "≈ $1,071+ / person" when incomplete. /impeccable clarify
- [P2] Board header became a settings bar (~7 controls: currency + split + 3 actions + people). Fix: travelers to People & invites; compact currency. /impeccable layout
- [P2] Combo radio change reloads page (WCAG 3.2.2). Fix: compute client-side or drop autosubmit. /impeccable harden
- [P3] "Make this the plan" primary button on a research page duplicating the Group decision. /impeccable quieter
- [P3] 10.88px type (--fs-2xs) below 11px floor; 4.47:1 contrast on selected empty state. /impeccable polish

## Persona Red Flags
- Sam (organizer): 7 header controls; two ways to select; apply silently demotes.
- Alex (comparing destinations): mixed-basis From; original EUR hidden in tooltip; per-person silently incomplete.
- Jordan (guest): pricing form competes with research; "I'm interested" buried below options.

## Minor
Breadcrumb + back link duplicated; "fits 6" in price column for a car; raw query string in share field; "Exploring" badge on every row adds little.

## Questions
- Is the combo a draft of the selected plan that belongs on the Selected plan page?
- Who needs per-person before the group knows who's going?
- Is display currency needed while researching, or only at booking time?
