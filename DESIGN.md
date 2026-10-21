---
name: Hotel Tracker
description: A warm, teal-accented shared travel research workspace, recorded from the approved first rework.
colors:
  ground: "#f5f3ee"
  paper: "#fffefa"
  ink: "#263d37"
  muted: "#647169"
  forest: "#173e38"
  forest-deep: "#11312c"
  teal: "#237363"
  teal-dark: "#185949"
  line: "#dadfd6"
  mint: "#e6eee5"
  danger: "#9b342f"
  white: "#fff"
  exploring-bg: "#eff1e9"
  exploring-text: "#516353"
  shortlisted-bg: "#e0ecd9"
  shortlisted-text: "#345d3f"
  booked-bg: "#33674b"
  passed-bg: "#f2e7e2"
  passed-text: "#79524a"
  sample-bg: "#f2e3ba"
  sample-text: "#71521f"
typography:
  display:
    fontFamily: "'DM Sans', 'Segoe UI', system-ui, sans-serif"
    fontSize: "clamp(1.8rem, 2.8vw, 2.65rem)"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-.035em"
  headline:
    fontFamily: "'DM Sans', 'Segoe UI', system-ui, sans-serif"
    fontSize: "1.13rem"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-.018em"
  title:
    fontFamily: "'DM Sans', 'Segoe UI', system-ui, sans-serif"
    fontSize: "1.13rem"
    fontWeight: 650
    lineHeight: 1.35
    letterSpacing: "-.015em"
  body:
    fontFamily: "'DM Sans', 'Segoe UI', system-ui, sans-serif"
    lineHeight: 1.55
  excerpt:
    fontSize: ".8rem"
    lineHeight: 1.65
  prose:
    fontSize: ".9rem"
    lineHeight: 1.85
  label:
    fontSize: ".83rem"
    fontWeight: 600
  button:
    fontSize: ".83rem"
    fontWeight: 600
  badge:
    fontSize: ".65rem"
    fontWeight: 650
  quote:
    fontSize: "1.02rem"
    fontWeight: 650
  budget:
    fontSize: "1.5rem"
    fontWeight: 650
  quote-total:
    fontSize: "2rem"
    fontWeight: 650
rounded:
  view-option: "5px"
  field: "7px"
  control: "8px"
  toast: "9px"
  radius: "12px"
  welcome: "18px"
  count: "20px"
  badge: "30px"
  avatar: "50%"
spacing:
  icon-gap: "8px"
  action-gap: "10px"
  card-gap: "16px"
  form-row-gap: "18px"
  card-inset: "20px"
  form-gap: "22px"
  group-gap: "24px"
  panel-inset: "28px"
  board-gap: "30px"
  page-top: "32px"
  page-gutter: "36px"
  page-bottom: "48px"
components:
  button-primary:
    backgroundColor: "{colors.teal}"
    textColor: "{colors.white}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "11px 16px"
  button-primary-hover:
    backgroundColor: "{colors.teal-dark}"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.forest}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "11px 16px"
  button-secondary-hover:
    backgroundColor: "#ebf0e7"
  button-subtle:
    backgroundColor: "transparent"
    textColor: "{colors.teal-dark}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "11px 16px"
  button-subtle-hover:
    backgroundColor: "#e7ece2"
  button-danger:
    backgroundColor: "#fff7f3"
    textColor: "{colors.danger}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "11px 16px"
  button-danger-hover:
    backgroundColor: "#f6e3dc"
  button-interested:
    backgroundColor: "#e1eadc"
    textColor: "#274e37"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "11px 16px"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "11px 12px"
    width: "100%"
  nav-link:
    textColor: "#d8e4d9"
    rounded: "{rounded.control}"
    padding: "12px 13px"
  nav-link-active:
    backgroundColor: "#e3eadb"
    textColor: "{colors.forest-deep}"
  badge-exploring:
    backgroundColor: "{colors.exploring-bg}"
    textColor: "{colors.exploring-text}"
    typography: "{typography.badge}"
    rounded: "{rounded.badge}"
    padding: "3px 9px"
  badge-shortlisted:
    backgroundColor: "{colors.shortlisted-bg}"
    textColor: "{colors.shortlisted-text}"
    typography: "{typography.badge}"
    rounded: "{rounded.badge}"
    padding: "3px 9px"
  badge-booked:
    backgroundColor: "{colors.booked-bg}"
    textColor: "{colors.white}"
    typography: "{typography.badge}"
    rounded: "{rounded.badge}"
    padding: "3px 9px"
  badge-passed:
    backgroundColor: "{colors.passed-bg}"
    textColor: "{colors.passed-text}"
    typography: "{typography.badge}"
    rounded: "{rounded.badge}"
    padding: "3px 9px"
  badge-sample:
    backgroundColor: "{colors.sample-bg}"
    textColor: "{colors.sample-text}"
    typography: "{typography.badge}"
    rounded: "{rounded.badge}"
    padding: "3px 9px"
  idea-card:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.radius}"
  trip-tile:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.radius}"
    padding: "23px"
  social-button:
    backgroundColor: "transparent"
    textColor: "#5f6d60"
    rounded: "{rounded.field}"
    padding: "7px"
  budget-summary:
    backgroundColor: "#e7ecdF"
    rounded: "{rounded.radius}"
    padding: "{spacing.card-inset}"
  quote-panel:
    backgroundColor: "#e6edde"
    rounded: "{rounded.radius}"
    padding: "{spacing.group-gap}"
---

# Design System: Hotel Tracker

## Overview

**Creative North Star: "A shared travel journal"**

Personal, approachable trip planning remains the incumbent character. The approved group-research rework expresses it through warm off-white ground, deep green navigation, teal actions, and quiet paper working surfaces. It is a working research space for a trusted group, not a luxury travel storefront or a corporate dashboard.

Typography and grouping carry the hierarchy. Contributor initials, outlined SVG symbols, and visible interest and discussion controls make participation legible without photography. Estimates, preferences, and booking decisions remain distinct; sample content stays visibly labeled.

**Key Characteristics:**
- Warm ground, paper surfaces, and teal actions anchored by deep green navigation.
- Self-hosted DM Sans, sentence-case hierarchy, and compact supporting metadata.
- Bordered research cards with visible attribution and interest controls.
- Responsive rails that become normal-flow navigation and stacked content.
- Native links and forms with small progressive JavaScript conveniences.

### Authority and retained legacy

This is an approved refresh of the existing system, not a replacement product identity. The frontmatter records the current planner only. Source authority: [planner.css](server/static/css/planner.css), [planner-shell.ejs](server/views/planner-shell.ejs), sampled [board](server/views/planner/board.ejs), [idea detail](server/views/planner/idea.ejs), [editor](server/views/planner/idea-form.ejs), [join](server/views/planner/join.ejs), [sharing](server/views/planner/share.ejs), [SVG symbols](server/views/planner/icons.ejs), and [progressive behavior](server/static/js/planner.js). Product and direction context remain in [PRODUCT.md](PRODUCT.md) and the [group-research brief](.impeccable/surfaces/group-research.md).

The previous document's terracotta primary, Outfit headings, and blanket no-white/no-blue rules were not the implemented app's system and are superseded here. Confirmed warm, approachable character, DM Sans usage, rounded working surfaces, and pill-shaped statuses are preserved. The retained [legacy stylesheet](server/static/css/styles.css) actually uses warm ground (`--bg: #F4F0E8`), teal (`--teal: #197A6F`), charcoal navigation, DM Sans body text, and Playfair Display branding/headings. It and the existing hotel views remain legacy, not migrated or overwritten. Do not load both palettes into the planner or apply planner tokens retroactively to the old views.

Evidence status: documentation verified against final source on 2026-10-12, with unchanged palette and type tokens. The supplied [desktop](.impeccable/review/desktop.png), [mobile](.impeccable/review/mobile.png), [guest-mobile](.impeccable/review/guest-mobile.png), [editor-mobile](.impeccable/review/editor-mobile.png), [share-mobile](.impeccable/review/share-mobile.png), [join-mobile](.impeccable/review/join-mobile.png), and [login-mobile](.impeccable/review/login-mobile.png) captures are final, replacing the preceding system-font evidence. This pass sampled desktop, editor, and join captures for documentation consistency. The supplied final reviewer disposition is **ship for the six scored fixes, all resolved**, not a whole-surface review. No tests, live interactions, contrast audit, or recapture were rerun in this documentation-only pass.

## Colors

Warm mineral neutrals and green-tinted surfaces support a teal action accent; amber and muted red are contextual, not competing brand identities. Frontmatter values are normative; local state literals remain in their source/component snippets.

### Primary
- **Teal / teal-dark:** primary action and hover; links use the darker teal and hover toward forest-deep. Radio accents and field carets use teal.
- **Forest / forest-deep:** persistent navigation ground, deep text accents, and toast ground. White supplies primary-button and toast text.

### Neutral
- **Ground / paper:** page canvas versus working surfaces; paper is intentionally warmer than pure white.
- **Ink / muted:** primary reading versus secondary guidance, metadata, and attribution.
- **Line / mint:** structural dividers versus quiet icon-button hover feedback.

### Semantic states
- **Exploring, shortlisted, booked, passed:** labeled status pills with separate foreground/background assignments. Booked is a solid green pill; passed is muted rose, not the danger action treatment.
- **Sample:** restrained amber pill for explicitly fictional content. Amber also appears in compass details and keyboard focus, using their actual local CSS values. The declared but unused `--amber` property is not promoted to a shipped component token.
- **Danger:** destructive controls, separate from the passed-on decision. Error notices use their own pale warm background and red-brown text.
- Category icons retain local destination green, stay ochre, transport blue, activity clay, and useful-link plum accents; none changes the teal action hierarchy.

**The Action and Decision Rule.** Teal identifies actions; labeled status tints identify decisions. Interest is a preference, not a booking.

The sidecar's eight-step OKLCH tonal ramps are generated preview metadata required by the document format. They are not shipped CSS, approved alternative palette values, or contrast certification.

## Typography

**Display and body font:** DM Sans with Segoe UI, system-ui, and sans-serif fallbacks. Two self-hosted WOFF2 subsets (Latin and Latin Extended) declare normal variable weight (400–700), `font-display: swap`, and Unicode ranges in the planner stylesheet. Font synthesis is disabled. Outfit and Playfair Display are not planner fonts; system faces are fallbacks, not the intended display style.

**Character:** a single workhorse sans, with medium-heavy headings, tighter heading tracking, and sentence-case labels. There is no invented modular ratio or separate display family.

### Hierarchy
- **Display:** the frontmatter's fluid page heading; small-screen page headings resolve to (1.8rem) at the narrow breakpoint.
- **Headline:** default section h2. Supporting-rail headings reduce to (.97rem); new-trip/sample/guide headings use (1.4rem).
- **Title:** idea-card h3; generic h3 is (1.1rem), and trip-tile h3 is (1.3rem). All use weight (650).
- **Body:** inherited root family and line-height; no explicit root font-size is set. Browser/user font sizing remains in force. Heading descriptions use (.92rem), narrowing to (.83rem) on small screens, with (68ch) maximum width.
- **Excerpt / prose:** card excerpts are three-line clamped; expanded idea notes preserve whitespace, wrap long content, and cap width at (70ch). Comments use (.85rem).
- **Labels / controls:** compact, weight (600). Button elements have line-height (1.3), while anchor buttons inherit root line-height (1.55); do not falsely normalize them in metadata.
- **Metadata / badges:** supporting text commonly ranges from (.7rem) to (.8rem); existing status pills use the badge role. These are compact ancillary treatments, not a proposed minimum readable size for future body copy.
- **Quotes / budgets:** card quote, budget, and detail-total roles use tabular numerals, as do counts in category and social controls.
- **Welcome:** heading (2.4rem / 1.15) and form heading (1.65rem); heading reduces to (2rem) at 760px, then (1.75rem) at 520px, where the form heading becomes (1.45rem). Authored heading line breaks remain enabled at 760px and below (`display: initial`).

**The One Family Rule.** Planner headings, forms, and reading text use DM Sans; legacy display typography does not leak into new planner surfaces.

## Layout

### Workspace and board
- The app grid uses a sticky, viewport-height navigation rail (224px) and a flexible workspace. The page supports a minimum body width (320px).
- Topbar height is (70px). Main content is centered at maximum width (1600px), with top/horizontal/bottom padding (32px / 36px / 48px).
- The board divides into flexible research and a summary rail (238px), with gap (30px). The summary is separated by a left border and inset (25px), not another floating card.
- Research cards form two equal columns with gap (16px); trip tiles use three columns with gap (20px). At minimum viewport width (1600px), research becomes three columns.
- Editors/sharing use a main column up to (760px), supporting column (220–300px), and gap (48px). Detail uses flexible content plus (280px), gap (40px).
- Welcome uses width `min(1050px, calc(100% - 48px))`, a (1.05fr / 1fr) panel, and internal insets (48px).
- Spacing is role-based rather than a strict invented 8px grid. Reused insets and gaps are in frontmatter; per-component exceptions remain explicit in source.

### Responsive decisions (viewport media queries)
| Query | Implemented change |
| --- | --- |
| `min-width: 1600px` | Research grid becomes three columns. |
| `max-width: 1250px` | Navigation narrows to 200px; content padding becomes 28px 26px 40px; board summary becomes 208px with 22px gap; trip grid becomes two columns; heading actions wrap within 190px. |
| `max-width: 1050px` | Board summary moves below research as two columns with a top border; editor/sharing become one column; detail retains a 230px aside with 24px gap; lower plans area stacks. |
| `max-width: 760px` | Sidebar becomes static, normal-flow header with horizontally scrollable navigation; viewer text/avatar and sidebar extras hide, sign-out remains. Topbar becomes 50px; main padding becomes 22px 20px 36px. Detail stacks, with a two-column aside below. Welcome stacks and hides supporting points. |
| `max-width: 520px` | Heading actions follow title at full width; research/trip grids, forms, and detail aside become one column. Search occupies its own row; categories wrap. Board summary stacks, member list becomes two columns; privacy text hides; copy controls and footer stack. Editor/detail/invite padding becomes 22px 18px. |

**The Rails Become Content Rule.** On smaller screens, navigation and supporting rails enter normal flow; the planner does not introduce an overlay drawer or fixed bottom navigation.

## Elevation & Depth

Depth comes primarily from paper-on-ground contrast, thin borders, and tinted supporting panels. Shadows are small and role-specific, not a blanket prohibition or a card-wide resting effect.

### Shadow vocabulary
- **Selected view:** `0 1px 3px #263d3712` on the selected all-research/shortlist option.
- **Research-card hover:** `0 5px 16px #263d3709`; no resting research-card shadow.
- **Toast:** `0 5px 20px #173e3826` for transient feedback.
- **Welcome panel:** `0 12px 40px #243e3709` for the joining/login container.

Buttons transition background/border color and research cards transition border color/shadow over (.15s), using default CSS easing. There is no entrance-animation system or hover translation. Reduced-motion preference removes transitions and forces automatic scrolling. The toast is fixed above the lower viewport edge (24px), centered with `translateX(-50%)`; this is positioning, not animation.

**The Quiet Depth Rule.** Preserve tonal separation and borders at rest; use the shipped small shadows only for their documented roles.

## Shapes

Working panels share `--radius`; controls use the smaller control radius, fields/categories/social buttons the field radius. Welcome is more rounded; pills use the badge radius, counts their own radius, and initials sit in circles. Thin (1px) borders remain native to this world; do not impose a no-border doctrine.

Icons are local SVG symbols, generally (20px) or (16px), with `currentColor`, no fill, rounded caps/joins, and stroke width (1.65). Compass branding is larger (34px); welcome/empty-state marks have explicit contextual sizes. Interested/voted hearts intentionally add a fill. Initials are text identity markers, not glyph icons. No raster assets are used by the planner.

## Components

### Buttons
Compact, rounded, sentence-case controls with explicit action hierarchy. Shared padding and radii are in frontmatter; minimum height is (44px), icon gap (8px), and border (1px). Primary is teal; secondary is paper with a pale green border; subtle is transparent; destructive is pale warm red with danger text. Each has source-defined hover except the selected interested variant, which has no distinct hover styling. Do not invent a pressed transform.

Visible keyboard focus is a (3px) amber outline (`#ad6e1c`) offset (4px). Busy submission lowers button opacity to (.65) and changes cursor to wait. Script disables the submit control after form values are collected and restores it on `pageshow`.

### Navigation, view switch, and category filters
Navigation pairs symbols with labels, uses a pale green selected surface against forest, and provides a darker green hover surface. Desktop links have minimum height (46px); mobile links (42px). The view switch is a bordered segmented link group with a small selected shadow. Category filters wrap, pair kind labels/icons/counts, and use a muted green selected border/background; minimum height is (40px). These are links, not JavaScript-only tabs.

### Badges and notices
Status pills map `considering` → Exploring, `shortlisted` → Shortlisted, `booked` → Booked, and `eliminated` → Passed on. Sample pills label fictional workspaces/ideas; the same shortlisted tint also marks the organizer role on sharing. Minimum badge height is (25px). Text labels carry meaning alongside color. Error notices are bordered warm-red blocks with `role="alert"`; no unsupported field-level error design is claimed.

### Research cards and shared interest
Paper cards have a border (`#dce1d6`), shared panel radius, clipped corners, and flexible vertical composition. There is no single all-over card padding: header margins are (20px 20px 14px), text uses side insets (20px), and footer padding is (10px 14px 10px 20px). Title links, external source links, and social controls are separate targets; the whole card is not a link.

Cards expose kind, status, notes, an optional total quote/capacity, source, contributor initials, interest, and discussion. Passed-on cards use a quieter ground and heading color, not disabled functionality. Footer social controls are at least (44px × 42px); selected interest changes text and heart fill, with `aria-pressed` conveying state. Detail interest uses the larger interested button variant. Authorship is preserved in the interface.

### Fields and forms
Paper inputs/selects/textareas have a green-gray border (`#bcc7b8`), shared field radius, and minimum height (44px). Label-to-field gap is (7px); stacked forms use (22px) gaps. Focus shifts border to teal in addition to the keyboard outline. Placeholder text is (`#647061`), full opacity, normal weight. Textareas resize vertically and start at minimum (90px).

Form-row children can shrink within their grid tracks (`min-width: 0`); rows stack at 520px and below. The quote fieldset retains a native, nonfloated legend with bottom margin (16px) and right padding (12px), separate from its field grid. These are layout safeguards, not new palette or type tokens.

Kind selection is native radios presented as labeled icon choices; checked state is pale green, and keyboard outline is forwarded to the visible span with (3px) offset. The destination field hides/disables for destination ideas only when script runs. Without JavaScript, links and forms remain usable. Search uses a visibly hidden accessible label and an inset search icon, not placeholder-only labeling.

### Supporting panels, quotes, and empty states
Budget and quote panels use sage-toned grounds and tabular numeric hierarchy. Missing amounts read as unknown, not zero; currencies are visibly kept separate. Member lists use initials rather than portrait assets. Empty states use a dashed border, pale ground, compass SVG, explanatory copy, and a real contribution action. No illustrative prices or sample items are silently presented as real offers.

### Joining, sharing, and feedback
Joining pairs a quiet welcome story with a name form; privacy and unverified-name guidance remain visible copy. Sharing uses a readonly invite field with a primary copy action and a fallback explaining the path when JavaScript is absent. Clipboard failure selects the link for manual copying. Destructive confirmations are native browser dialogs, not custom modal components. The polite live-region toast dismisses after (5000ms). The sidecar's specimens are visual samples, not working forms connected to application mutations.

## Do's and Don'ts

### Do:
- **Do** preserve warm ground, paper work surfaces, deep green navigation, and teal action hierarchy.
- **Do** use self-hosted DM Sans and the documented sentence-case hierarchy on planner surfaces.
- **Do** retain visible focus, labeled SVG controls, attribution, and interest state beyond color alone.
- **Do** keep estimates, preferences, bookings, and clearly labeled sample content distinct.
- **Do** use native links and forms and let supporting rails stack into normal flow.

### Don't:
- **Don't** reintroduce the stale terracotta/Outfit specification or merge the legacy stylesheet into the planner.
- **Don't** replace SVG symbols with emoji, glyph icons, or decorative raster assets for these planner components.
- **Don't** convert every tint into a brand accent or ban contextual blue, white, borders, or subtle shadows that the implementation uses.
- **Don't** treat synthetic tonal ramps, compact metadata sizes, or the bounded six-fix ship verdict as approval for unreviewed visual changes.

Not canonized or repaired: legacy eyebrow styles remain legacy craft-floor defects, not a heading recipe for the planner; compact ancillary text is recorded only in its existing role, not as a new readability floor. The six scored fixes are reported resolved; this record does not broaden that verdict into whole-surface or contrast certification. App and legacy files are outside this documentation-only update.
