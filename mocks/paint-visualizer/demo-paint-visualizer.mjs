import { applyPaintPreview } from './paint-visualizer.mjs';

function makeBaseImage() {
  // 4x2 RGBA pixels:
  // top row: bright neutral wall tones
  // bottom row: darker/saturated furniture-ish tones
  const px = [
    210, 210, 205, 255,
    220, 216, 210, 255,
    200, 198, 193, 255,
    208, 206, 201, 255,

    90, 60, 40, 255,
    70, 90, 120, 255,
    40, 110, 80, 255,
    100, 40, 60, 255,
  ];
  return new Uint8ClampedArray(px);
}

function makeFullMask() {
  const arr = new Uint8ClampedArray(8 * 4);
  for (let i = 0; i < arr.length; i += 4) {
    arr[i + 3] = 255;
  }
  return arr;
}

function countChanged(before, after) {
  let changed = 0;
  for (let i = 0; i < before.length; i += 4) {
    if (
      before[i] !== after[i] ||
      before[i + 1] !== after[i + 1] ||
      before[i + 2] !== after[i + 2]
    ) {
      changed += 1;
    }
  }
  return changed;
}

const base = makeBaseImage();
const mask = makeFullMask();

const wallOnlyLab = applyPaintPreview(base, mask, {
  targetHex: '#5c7792',
  opacity: 0.88,
  mode: 'lab',
  wallOnly: true,
});

const flatNoFilter = applyPaintPreview(base, mask, {
  targetHex: '#5c7792',
  opacity: 0.88,
  mode: 'flat',
  wallOnly: false,
});

console.log('base_pixels=8');
console.log(`changed_wall_only_lab=${countChanged(base, wallOnlyLab)}`);
console.log(`changed_flat_no_filter=${countChanged(base, flatNoFilter)}`);
console.log('sample_wall_only_lab_top_left=', [...wallOnlyLab.slice(0, 4)]);
console.log('sample_flat_no_filter_bottom_left=', [...flatNoFilter.slice(16, 20)]);
