# 🏨 Hotel Tracker

> Personal vacation hotel shortlist app — paste a link, compare candidates, make a confident pick.

**Stack:** EJS + Express + Pico.css + HTMX + Postgres + Docker

## Docs
- [Design Doc](docs/design.md) — vision, schema, phases, Hermes cron integration
- [Paint Visualizer MVP](mocks/paint-visualizer/README.md) — practical in-browser wall recolor module using `sico-colors.json`

## Status
🌱 Mock-first phase. Core trip mocks + Paint Visualizer MVP are usable.

## Run mocks locally

```bash
cd /home/cribe/GitRepos/hotel-tracker/mocks
python3 -m http.server 8766
```

Open:
- `http://localhost:8766/index.html`
- `http://localhost:8766/paint-visualizer/paint-visualizer-demo.html`
