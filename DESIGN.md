---
version: alpha
name: Hotel Tracker
description: Warm, casual trip planning tool. Feels like a personal travel journal — approachable, functional, sun-bleached vacation vibes. Not corporate, not luxury. The kind of app you open on your phone at the kitchen table while dreaming about Punta Cana.
colors:
  bg: "#F8F4EE"
  surface: "#FFFFFF"
  primary: "#B85A2C"
  primary-dark: "#8F3F14"
  secondary: "#E8A246"
  text: "#2C2416"
  text-muted: "#8A7A6A"
  border: "#E2D8CC"
  success: "#4A7C59"
  danger: "#B84040"
  considering: "#3A6FA8"
typography:
  h1:
    fontFamily: Outfit
    fontSize: 2rem
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  h2:
    fontFamily: Outfit
    fontSize: 1.4rem
    fontWeight: 600
    lineHeight: 1.3
  body-md:
    fontFamily: DM Sans
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.6
  body-sm:
    fontFamily: DM Sans
    fontSize: 0.875rem
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: DM Sans
    fontSize: 0.75rem
    fontWeight: 600
    letterSpacing: "0.06em"
rounded:
  sm: 6px
  md: 12px
  lg: 20px
  full: 999px
spacing:
  sm: 8px
  md: 16px
  lg: 24px
  xl: 40px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#FFFFFF"
    rounded: "{rounded.md}"
    padding: "10px 20px"
  button-primary-hover:
    backgroundColor: "{colors.primary-dark}"
    textColor: "#FFFFFF"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.primary}"
    rounded: "{rounded.md}"
    padding: "10px 20px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "{spacing.lg}"
  badge-considering:
    backgroundColor: "#EBF2FA"
    textColor: "{colors.considering}"
    rounded: "{rounded.full}"
    padding: "3px 10px"
  badge-eliminated:
    backgroundColor: "#FAEAEA"
    textColor: "{colors.danger}"
    rounded: "{rounded.full}"
    padding: "3px 10px"
  badge-booked:
    backgroundColor: "#EAF3EC"
    textColor: "#3A6647"
    rounded: "{rounded.full}"
    padding: "3px 10px"
---

## Overview

Warm vacation-planning tool. Sandy background, terracotta primary, golden accent. Feels like a well-worn travel journal — personal, approachable, functional. No luxury pretense, no corporate sterility. DM Sans for body (friendly, readable), Outfit for headings (modern, slightly playful).

## Colors

- **Background (#F8F4EE):** Warm sand — feels like beach, not hospital white.
- **Surface (#FFFFFF):** Cards pop cleanly against the sandy background.
- **Primary (#C96B3F):** Terracotta/burnt orange — sunset, warmth, vacation energy. Used for CTAs and key actions.
- **Secondary (#E8A246):** Warm amber/golden — accents, highlights, star ratings.
- **Text (#2C2416):** Dark warm brown — not pure black, softer on warm backgrounds.
- **Muted (#8A7A6A):** Warm gray — secondary text, metadata, timestamps.
- **Border (#E2D8CC):** Warm beige dividers — subtle, not cold gray.
- **Success (#4A7C59):** Earthy green — "Booked" status badge.
- **Danger (#B84040):** Muted red — "Eliminated" status badge.
- **Considering (#3A6FA8):** Calm blue — "Considering" status badge.

## Typography

Outfit for headings — modern, rounded, slightly playful. DM Sans for body — clean, friendly, highly legible on mobile. Both are free Google Fonts.

## Layout

Cards on a sandy grid. Trip dashboard = 2-column card grid on desktop, 1-column on mobile. Comparison view = full-width table. Generous padding inside cards — this is browsed at leisure, not scanned under pressure.

## Components

Status badges are pill-shaped with muted background tints — blue/red/green — not jarring, reads at a glance. Star rating uses the secondary amber/golden color. CTA buttons are terracotta — one per card.

## Do's and Don'ts

- ✅ Use warm sandy tones throughout, never cold grays
- ✅ Round corners generously (12-20px on cards)
- ✅ Give cards breathing room — don't pack them tight
- ✅ Status badges always pill-shaped
- ❌ No blue links (text is warm brown, accents are terracotta)
- ❌ No pure white backgrounds (always #F8F4EE sandy base)
- ❌ No sharp corners on interactive elements
