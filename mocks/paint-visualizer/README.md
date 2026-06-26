# Paint Visualizer MVP (KISS)

Practical in-browser MVP to preview SICO paint colors on a room photo.

## What is included

- `paint-visualizer-demo.html` — usable UI (upload image, paint/erase mask, select color, export PNG)
- `paint-visualizer.mjs` — reusable module
  - `applyPaintPreview(baseData, maskData, options)`
  - `PaintVisualizer` class
  - `hexToRgb`, `rgbToLab`, `labToRgb`
- `sico-colors.json` — SICO color dataset used directly by the UI
- `demo-paint-visualizer.mjs` — CLI smoke demo for module behavior

## Run locally

```bash
cd /home/cribe/GitRepos/hotel-tracker/mocks
python3 -m http.server 8766
```

Open:
- `http://localhost:8766/paint-visualizer/paint-visualizer-demo.html`

## Quick usage

1. Upload a room photo.
2. Click a SICO color from the list (search by name/code).
3. Paint mask over walls.
4. Tune opacity/mode (`LAB` realistic or `Flat` strong).
5. Export PNG.

## CLI verification

```bash
cd /home/cribe/GitRepos/hotel-tracker/mocks/paint-visualizer
node demo-paint-visualizer.mjs
```

Expected: `changed_flat_no_filter` should be greater than or equal to `changed_wall_only_lab`.

## MVP scope limits

- Manual mask only (no auto wall segmentation)
- No undo stack
- No project persistence
