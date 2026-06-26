// KISS MVP paint visualizer module.
// Browser-first, with pure applyPaintPreview() export for CLI smoke tests.

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

function clamp255(v) {
  return Math.min(255, Math.max(0, v));
}

export function hexToRgb(hex) {
  const clean = String(hex || '').trim().replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) {
    throw new Error(`Invalid hex color: ${hex}`);
  }
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

function srgbToLinear(u) {
  return u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(u) {
  return u <= 0.0031308 ? (12.92 * u) : (1.055 * (u ** (1 / 2.4)) - 0.055);
}

function rgbToXyz(r, g, b) {
  const R = srgbToLinear(clamp01(r / 255));
  const G = srgbToLinear(clamp01(g / 255));
  const B = srgbToLinear(clamp01(b / 255));

  return {
    x: (0.4124564 * R + 0.3575761 * G + 0.1804375 * B),
    y: (0.2126729 * R + 0.7151522 * G + 0.0721750 * B),
    z: (0.0193339 * R + 0.1191920 * G + 0.9503041 * B),
  };
}

function xyzToRgb(x, y, z) {
  const rl = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
  const gl = -0.9692660 * x + 1.8760108 * y + 0.0415560 * z;
  const bl = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;

  return {
    r: clamp255(Math.round(clamp01(linearToSrgb(rl)) * 255)),
    g: clamp255(Math.round(clamp01(linearToSrgb(gl)) * 255)),
    b: clamp255(Math.round(clamp01(linearToSrgb(bl)) * 255)),
  };
}

function xyzToLab(x, y, z) {
  const Xn = 0.95047;
  const Yn = 1.00000;
  const Zn = 1.08883;

  const f = (t) => {
    const d = 6 / 29;
    return t > d ** 3 ? Math.cbrt(t) : (t / (3 * d * d) + 4 / 29);
  };

  const fx = f(x / Xn);
  const fy = f(y / Yn);
  const fz = f(z / Zn);

  return {
    L: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

function labToXyz(L, a, b) {
  const Xn = 0.95047;
  const Yn = 1.00000;
  const Zn = 1.08883;

  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;

  const invf = (t) => {
    const d = 6 / 29;
    return t > d ? t ** 3 : 3 * d * d * (t - 4 / 29);
  };

  return {
    x: Xn * invf(fx),
    y: Yn * invf(fy),
    z: Zn * invf(fz),
  };
}

export function rgbToLab(r, g, b) {
  const { x, y, z } = rgbToXyz(r, g, b);
  return xyzToLab(x, y, z);
}

export function labToRgb(L, a, b) {
  const { x, y, z } = labToXyz(L, a, b);
  return xyzToRgb(x, y, z);
}

function isLikelyWallPixel(r, g, b, brightnessMin, satMax) {
  const brightness = (r + g + b) / 3;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const sat = mx > 0 ? (mx - mn) / mx : 0;
  return brightness > brightnessMin && sat < satMax;
}

function colorDistanceSq(r1, g1, b1, r2, g2, b2) {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return dr * dr + dg * dg + db * db;
}

function edgeStrength(base, idx, w, h, x, y) {
  const i = idx;
  const r = base[i];
  const g = base[i + 1];
  const b = base[i + 2];

  let gx = 0;
  let gy = 0;

  if (x > 0) {
    const il = i - 4;
    gx += Math.abs(r - base[il]) + Math.abs(g - base[il + 1]) + Math.abs(b - base[il + 2]);
  }
  if (x < w - 1) {
    const ir = i + 4;
    gx += Math.abs(r - base[ir]) + Math.abs(g - base[ir + 1]) + Math.abs(b - base[ir + 2]);
  }
  if (y > 0) {
    const iu = i - w * 4;
    gy += Math.abs(r - base[iu]) + Math.abs(g - base[iu + 1]) + Math.abs(b - base[iu + 2]);
  }
  if (y < h - 1) {
    const id = i + w * 4;
    gy += Math.abs(r - base[id]) + Math.abs(g - base[id + 1]) + Math.abs(b - base[id + 2]);
  }

  return gx + gy;
}

export function applyPaintPreview(baseData, maskData, options = {}) {
  const {
    targetHex,
    opacity = 0.85,
    mode = 'lab', // 'lab' | 'flat'
    wallOnly = true,
    brightnessMin = 130,
    satMax = 0.2,
  } = options;

  if (!targetHex) return new Uint8ClampedArray(baseData);

  const { r: tr, g: tg, b: tb } = hexToRgb(targetHex);
  const targetLab = rgbToLab(tr, tg, tb);
  const out = new Uint8ClampedArray(baseData);

  for (let i = 0; i < out.length; i += 4) {
    const maskAlpha = (maskData[i + 3] / 255) * opacity;
    if (maskAlpha <= 0) continue;

    const br = out[i];
    const bg = out[i + 1];
    const bb = out[i + 2];

    if (wallOnly && !isLikelyWallPixel(br, bg, bb, brightnessMin, satMax)) {
      continue;
    }

    let nr;
    let ng;
    let nb;

    if (mode === 'lab') {
      const srcLab = rgbToLab(br, bg, bb);
      const recolored = labToRgb(srcLab.L, targetLab.a, targetLab.b);
      nr = recolored.r;
      ng = recolored.g;
      nb = recolored.b;
    } else {
      nr = tr;
      ng = tg;
      nb = tb;
    }

    out[i] = Math.round(br * (1 - maskAlpha) + nr * maskAlpha);
    out[i + 1] = Math.round(bg * (1 - maskAlpha) + ng * maskAlpha);
    out[i + 2] = Math.round(bb * (1 - maskAlpha) + nb * maskAlpha);
  }

  return out;
}

export class PaintVisualizer {
  constructor(config) {
    this.stage = config.stage;
    this.previewCanvas = config.previewCanvas;
    this.geometryCanvas = config.geometryCanvas;
    this.maskCanvas = config.maskCanvas;
    this.uploadInput = config.uploadInput;
    this.autoFillButton = config.autoFillButton;
    this.paintButton = config.paintButton;
    this.eraseButton = config.eraseButton;
    this.toleranceInput = config.toleranceInput;
    this.quickToleranceInput = config.quickToleranceInput;
    this.brushInput = config.brushInput;
    this.quickBrushInput = config.quickBrushInput;
    this.opacityInput = config.opacityInput;
    this.quickOpacityInput = config.quickOpacityInput;
    this.zoomInButton = config.zoomInButton;
    this.zoomOutButton = config.zoomOutButton;
    this.fitButton = config.fitButton;
    this.resetViewButton = config.resetViewButton;
    this.modeInput = config.modeInput;
    this.wallOnlyInput = config.wallOnlyInput;
    this.edgeLockInput = config.edgeLockInput;
    this.clearButton = config.clearButton;
    this.wallZoneButton = config.wallZoneButton;
    this.noDrawZoneButton = config.noDrawZoneButton;
    this.finishZoneButton = config.finishZoneButton;
    this.lockGeometryButton = config.lockGeometryButton;
    this.nextStepButton = config.nextStepButton;
    this.editMaskButton = config.editMaskButton;
    this.clearZonesButton = config.clearZonesButton;
    this.exportZonesButton = config.exportZonesButton;
    this.importZonesInput = config.importZonesInput;
    this.workflowStatusEl = config.workflowStatusEl;
    this.paletteListEl = config.paletteListEl;
    this.searchInputEl = config.searchInputEl;
    this.exportButton = config.exportButton;
    this.colorChip = config.colorChip;
    this.colorLabel = config.colorLabel;
    this.step1ToolRow = config.step1ToolRow;
    this.zoneIoRow = config.zoneIoRow;
    this.toleranceGroup = config.toleranceGroup;
    this.brushGroup = config.brushGroup;
    this.opacityGroup = config.opacityGroup;
    this.modeGroup = config.modeGroup;
    this.wallOnlyGroup = config.wallOnlyGroup;
    this.edgeLockGroup = config.edgeLockGroup;
    this.colorSelectionRow = config.colorSelectionRow;
    this.step2ActionsRow = config.step2ActionsRow;
    this.searchLabel = config.searchLabel;
    this.toast = typeof config.toast === 'function' ? config.toast : () => {};

    this.previewCtx = this.previewCanvas.getContext('2d', { willReadFrequently: true });
    this.geometryCtx = this.geometryCanvas?.getContext('2d', { willReadFrequently: true }) || null;
    this.maskCtx = this.maskCanvas.getContext('2d', { willReadFrequently: true });

    this.selectedColor = null;
    this.isDrawing = false;
    this.currentTool = 'paint';
    this.originalImageData = null;
    this.maskOverlayOpacityIdle = 0.62;
    this.maskOverlayOpacityActive = 0.48;
    this.viewScale = 1;
    this.zoneMode = 'none'; // none | wall | exclude
    this.currentZonePoints = [];
    this.wallZones = [];
    this.excludeZones = [];
    this.geometryLocked = false;
    this.workflowStep = 'zone'; // zone | color
    this.simpleTwoStep = true;

    this._bindEvents();
    this._setWorkflowStep('zone');
  }

  _bindEvents() {
    const syncPair = (a, b, onChange) => {
      if (!a || !b) return;
      const sync = (source, target) => {
        target.value = source.value;
        onChange?.(source.value);
      };
      a.addEventListener('input', () => sync(a, b));
      b.addEventListener('input', () => sync(b, a));
    };

    syncPair(this.brushInput, this.quickBrushInput);
    syncPair(this.opacityInput, this.quickOpacityInput, () => this.recolorPreview());
    syncPair(this.toleranceInput, this.quickToleranceInput);

    this.zoomInButton?.addEventListener('click', () => this._setScale(this.viewScale * 1.2));
    this.zoomOutButton?.addEventListener('click', () => this._setScale(this.viewScale / 1.2));
    this.resetViewButton?.addEventListener('click', () => this._setScale(1));
    this.fitButton?.addEventListener('click', () => this._fitToViewport());

    this.maskCanvas.addEventListener('pointerdown', (e) => {
      if (!this.originalImageData) return;
      const p = this._getCanvasCoords(e, this.maskCanvas);

      if (this.workflowStep !== 'zone') {
        return;
      }

      if (!this.simpleTwoStep && (this.zoneMode === 'wall' || this.zoneMode === 'exclude') && !this.geometryLocked) {
        this._addCurrentZonePoint(p.x, p.y);
        return;
      }

      if (this.currentTool === 'auto') {
        this._autoFillFrom(p.x, p.y);
        this.recolorPreview();
        return;
      }

      this.isDrawing = true;
      this._drawAt(p.x, p.y);
      this.recolorPreview();
    });

    this.maskCanvas.addEventListener('pointermove', (e) => {
      if (this.workflowStep !== 'zone') return;
      if (!this.isDrawing || this.currentTool === 'auto') return;
      const p = this._getCanvasCoords(e, this.maskCanvas);
      this._drawAt(p.x, p.y);
    });

    window.addEventListener('pointerup', () => {
      this.isDrawing = false;
    });

    this.autoFillButton?.addEventListener('click', () => {
      if (this.workflowStep !== 'zone') {
        this.toast('Use Back to Step 1 to edit zone.');
        return;
      }
      this.currentTool = 'auto';
      this.autoFillButton.classList.add('active');
      this.paintButton.classList.remove('active');
      this.eraseButton.classList.remove('active');
      this.toast('Tap on wall to fill connected zone');
    });

    this.paintButton.addEventListener('click', () => {
      if (this.workflowStep !== 'zone') {
        this.toast('Use Back to Step 1 to edit zone.');
        return;
      }
      this.currentTool = 'paint';
      this.paintButton.classList.add('active');
      this.eraseButton.classList.remove('active');
      this.autoFillButton?.classList.remove('active');
      this.toast('Paint mode: drag finger to add blue zone.');
    });

    this.eraseButton.addEventListener('click', () => {
      if (this.workflowStep !== 'zone') {
        this.toast('Use Back to Step 1 to edit zone.');
        return;
      }
      this.currentTool = 'erase';
      this.eraseButton.classList.add('active');
      this.paintButton.classList.remove('active');
      this.autoFillButton?.classList.remove('active');
      this.toast('Erase mode: drag finger to remove blue zone.');
    });

    this.wallZoneButton?.addEventListener('click', () => {
      this._setZoneMode('wall');
      this.toast('Wall zone mode: tap points, then Finish zone.');
    });

    this.noDrawZoneButton?.addEventListener('click', () => {
      this._setZoneMode('exclude');
      this.toast('No-draw mode: tap points, then Finish zone.');
    });

    this.finishZoneButton?.addEventListener('click', () => this._finishCurrentZone());
    this.lockGeometryButton?.addEventListener('click', () => this._lockGeometry());
    this.nextStepButton?.addEventListener('click', () => this._goToColorStep());
    this.editMaskButton?.addEventListener('click', () => this._backToMaskStep());
    this.clearZonesButton?.addEventListener('click', () => this._clearZones());
    this.exportZonesButton?.addEventListener('click', () => this._exportZones());

    this.importZonesInput?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      this._importZonesFile(file);
      e.target.value = '';
    });

    this.opacityInput.addEventListener('input', () => this.recolorPreview());
    this.modeInput?.addEventListener('change', () => this.recolorPreview());
    this.wallOnlyInput?.addEventListener('change', () => this.recolorPreview());
    this.edgeLockInput?.addEventListener('change', () => this.recolorPreview());

    this.clearButton.addEventListener('click', () => {
      if (!this.originalImageData) return;
      if (this.workflowStep !== 'zone') {
        this.toast('Use Back to Step 1 to edit zone.');
        return;
      }
      this.maskCtx.clearRect(0, 0, this.maskCanvas.width, this.maskCanvas.height);
      this.recolorPreview();
      this.toast('Mask cleared');
    });

    this.exportButton.addEventListener('click', () => {
      if (!this.originalImageData) {
        this.toast('Upload image first');
        return;
      }
      const a = document.createElement('a');
      a.href = this.previewCanvas.toDataURL('image/png');
      a.download = 'paint-preview.png';
      a.click();
      this.toast('Exported preview PNG');
    });

    this.uploadInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      this.loadFile(file);
    });
  }

  setColor(color) {
    this.selectedColor = color;
    this.colorChip.style.background = color.hex;
    this.colorLabel.textContent = `${color.code} • ${color.name} • ${color.hex.toUpperCase()}`;
    this._syncMaskOverlayOpacity();
    this.recolorPreview();
    if (this._hasAnyMask()) {
      this.toast('Color applied to current zone.');
    } else {
      this.toast('Color selected. Draw zone to apply.');
    }
  }

  loadFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        this._setupCanvasForImage(img);
        this.toast('Step 1: drag finger to paint blue zone.');
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  _setupCanvasForImage(img) {
    const maxW = 980;
    const scale = Math.min(1, maxW / img.width);
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);

    this.previewCanvas.width = w;
    this.previewCanvas.height = h;
    this.geometryCanvas.width = w;
    this.geometryCanvas.height = h;
    this.maskCanvas.width = w;
    this.maskCanvas.height = h;

    this.previewCanvas.style.width = `${w}px`;
    this.previewCanvas.style.height = `${h}px`;
    this.geometryCanvas.style.width = `${w}px`;
    this.geometryCanvas.style.height = `${h}px`;
    this.maskCanvas.style.width = `${w}px`;
    this.maskCanvas.style.height = `${h}px`;
    this.viewScale = 1;

    this.previewCtx.clearRect(0, 0, w, h);
    this.geometryCtx?.clearRect(0, 0, w, h);
    this.maskCtx.clearRect(0, 0, w, h);
    this.previewCtx.drawImage(img, 0, 0, w, h);
    this.originalImageData = this.previewCtx.getImageData(0, 0, w, h);
    this.currentTool = 'paint';
    this.paintButton.classList.add('active');
    this.eraseButton.classList.remove('active');
    this.autoFillButton?.classList.remove('active');
    this.currentZonePoints = [];
    this.wallZones = [];
    this.excludeZones = [];
    this.geometryLocked = false;
    this.selectedColor = null;
    this.colorChip.style.background = '#fff';
    this.colorLabel.textContent = 'No color selected';
    this._setZoneMode('none');
    this._setWorkflowStep('zone');
    this._drawGeometryOverlay();
    this._syncMaskOverlayOpacity();
    this.stage.style.display = 'block';
    this._fitToViewport();
  }

  recolorPreview() {
    if (!this.originalImageData) return;

    const w = this.previewCanvas.width;
    const h = this.previewCanvas.height;
    const maskData = this.maskCtx.getImageData(0, 0, w, h).data;

    const out = new Uint8ClampedArray(this.originalImageData.data);

    if (this.selectedColor) {
      const recolored = applyPaintPreview(this.originalImageData.data, maskData, {
        targetHex: this.selectedColor.hex,
        opacity: Number(this.opacityInput.value || 85) / 100,
        mode: this.modeInput?.value || 'lab',
        wallOnly: this.wallOnlyInput?.checked ?? true,
      });
      out.set(recolored);
    }

    this.previewCtx.putImageData(new ImageData(out, w, h), 0, 0);
  }

  _getCanvasCoords(e, canvas) {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    return { x, y };
  }

  _syncMaskOverlayOpacity() {
    if (!this.maskCanvas) return;
    this.maskCanvas.style.opacity = this.selectedColor
      ? String(this.maskOverlayOpacityActive)
      : String(this.maskOverlayOpacityIdle);
  }

  _setScale(scale) {
    if (!this.stage || !this.previewCanvas || !this.maskCanvas) return;
    const next = Math.max(0.5, Math.min(3, scale));
    this.viewScale = next;

    const w = this.previewCanvas.width;
    const h = this.previewCanvas.height;
    const sw = Math.round(w * next);
    const sh = Math.round(h * next);

    this.previewCanvas.style.width = `${sw}px`;
    this.previewCanvas.style.height = `${sh}px`;
    this.geometryCanvas.style.width = `${sw}px`;
    this.geometryCanvas.style.height = `${sh}px`;
    this.maskCanvas.style.width = `${sw}px`;
    this.maskCanvas.style.height = `${sh}px`;
  }

  _fitToViewport() {
    if (!this.stage || !this.previewCanvas) return;
    const w = this.previewCanvas.width || 1;
    const fitScale = Math.max(0.5, Math.min(2, (this.stage.clientWidth - 6) / w));
    this._setScale(fitScale);
  }

  _setZoneMode(mode) {
    if (this.workflowStep !== 'zone' && (mode === 'wall' || mode === 'exclude')) {
      this.toast('Zone editing is locked in color step. Clear zones to edit again.');
      return;
    }
    this.zoneMode = mode;
    this.wallZoneButton?.classList.toggle('active', mode === 'wall');
    this.noDrawZoneButton?.classList.toggle('active', mode === 'exclude');
  }

  _setWorkflowStep(step) {
    this.workflowStep = 'zone'; // KISS mode: single continuous flow

    const setDisabled = (el, disabled) => {
      if (!el) return;
      if ('disabled' in el) el.disabled = !!disabled;
      el.style.opacity = disabled ? '0.55' : '1';
      el.style.pointerEvents = disabled ? 'none' : 'auto';
    };

    const setVisible = (el, visible) => {
      if (!el) return;
      el.style.display = visible ? '' : 'none';
    };

    // Keep core controls always available
    setDisabled(this.paintButton, false);
    setDisabled(this.eraseButton, false);
    setDisabled(this.clearButton, false);
    setDisabled(this.brushInput, false);
    setDisabled(this.opacityInput, false);
    setDisabled(this.modeInput, false);
    setDisabled(this.wallOnlyInput, false);
    setDisabled(this.edgeLockInput, false);
    setDisabled(this.searchInputEl, false);
    setDisabled(this.paletteListEl, false);
    setDisabled(this.exportButton, false);

    // Hide unused advanced/legacy controls
    setVisible(this.zoneIoRow, false);
    setVisible(this.wallZoneButton?.parentElement, false);
    setVisible(this.autoFillButton, false);
    setVisible(this.nextStepButton, false);
    setVisible(this.editMaskButton, false);
    setVisible(this.toleranceGroup, false);

    // Show only core KISS controls
    setVisible(this.step1ToolRow, true);
    setVisible(this.brushGroup, true);
    setVisible(this.opacityGroup, false);
    setVisible(this.modeGroup, false);
    setVisible(this.wallOnlyGroup, false);
    setVisible(this.edgeLockGroup, false);
    setVisible(this.colorSelectionRow, true);
    setVisible(this.step2ActionsRow, true);
    setVisible(this.searchLabel, true);
    setVisible(this.searchInputEl, true);
    setVisible(this.paletteListEl, true);

    if (this.workflowStatusEl) {
      this.workflowStatusEl.textContent = '1) Select picture  2) Paint blue zone  3) Pick color';
    }
  }

  _goToColorStep() {
    if (!this.originalImageData) {
      this.toast('Upload image first.');
      return;
    }
    const hasMask = this._hasAnyMask();
    if (!hasMask) {
      this.toast('Mark at least one paint area first.');
      return;
    }
    this.geometryLocked = true;
    this._setWorkflowStep('color');
    this.recolorPreview();
    this.toast('Step 2 unlocked: pick a SICO color.');
  }

  _backToMaskStep() {
    if (!this.originalImageData) return;
    this.geometryLocked = false;
    this.currentTool = 'paint';
    this.paintButton?.classList.add('active');
    this.eraseButton?.classList.remove('active');
    this.autoFillButton?.classList.remove('active');
    this._setWorkflowStep('zone');
    this.toast('Back to drawing zone.');
  }

  _hasAnyMask() {
    if (!this.maskCanvas || !this.maskCtx) return false;
    const { width, height } = this.maskCanvas;
    if (!width || !height) return false;
    const data = this.maskCtx.getImageData(0, 0, width, height).data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 8) return true;
    }
    return false;
  }

  _drawGeometryOverlay() {
    if (!this.geometryCtx || !this.geometryCanvas) return;
    const ctx = this.geometryCtx;
    const w = this.geometryCanvas.width;
    const h = this.geometryCanvas.height;
    ctx.clearRect(0, 0, w, h);

    const drawPoly = (pts, fill, stroke) => {
      if (!pts || pts.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i].x, pts[i].y);
      if (pts.length >= 3) ctx.closePath();
      ctx.fillStyle = fill;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();
    };

    this.wallZones.forEach((pts) => drawPoly(pts, 'rgba(255,0,0,0.14)', 'rgba(255,0,0,0.9)'));
    this.excludeZones.forEach((pts) => drawPoly(pts, 'rgba(0,255,120,0.16)', 'rgba(0,200,100,0.95)'));

    if (this.currentZonePoints.length) {
      const previewColor = this.zoneMode === 'exclude'
        ? { fill: 'rgba(0,255,120,0.08)', stroke: 'rgba(0,180,90,0.9)' }
        : { fill: 'rgba(255,0,0,0.08)', stroke: 'rgba(200,0,0,0.9)' };
      drawPoly(this.currentZonePoints, previewColor.fill, previewColor.stroke);
      this.currentZonePoints.forEach((p) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3.2, 0, Math.PI * 2);
        ctx.fillStyle = previewColor.stroke;
        ctx.fill();
      });
    }
  }

  _addCurrentZonePoint(x, y) {
    if (this.geometryLocked) {
      this.toast('Geometry locked. Clear zones or import new zones to edit.');
      return;
    }
    if (this.zoneMode !== 'wall' && this.zoneMode !== 'exclude') return;
    this.currentZonePoints.push({ x, y });
    this._drawGeometryOverlay();
  }

  _finishCurrentZone() {
    if (this.currentZonePoints.length < 3) {
      this.toast('Need at least 3 points to finish zone.');
      return;
    }
    const zone = this.currentZonePoints.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
    if (this.zoneMode === 'exclude') {
      this.excludeZones.push(zone);
      this.toast(`No-draw zone saved (${zone.length} pts)`);
    } else {
      this.wallZones.push(zone);
      this.toast(`Wall zone saved (${zone.length} pts)`);
    }
    this.currentZonePoints = [];
    this._drawGeometryOverlay();
    this._rebuildMaskFromGeometry();
    this.recolorPreview();
  }

  _clearZones() {
    this.currentZonePoints = [];
    this.wallZones = [];
    this.excludeZones = [];
    this.geometryLocked = false;
    this._setZoneMode('none');
    this._setWorkflowStep('zone');
    this._drawGeometryOverlay();
    this.maskCtx.clearRect(0, 0, this.maskCanvas.width, this.maskCanvas.height);
    this.recolorPreview();
    this.toast('Geometry cleared');
  }

  _lockGeometry() {
    if (this.simpleTwoStep) {
      this._goToColorStep();
      return;
    }
    if (!this.wallZones.length) {
      this.toast('Add at least one wall zone first.');
      return;
    }
    this.geometryLocked = true;
    this.currentZonePoints = [];
    this._setZoneMode('none');
    this._drawGeometryOverlay();
    this._rebuildMaskFromGeometry();
    this._setWorkflowStep('color');
    this.recolorPreview();
    this.toast('Geometry locked. Step 2: select color.');
  }

  _zonesPayload() {
    return {
      version: 1,
      image: {
        width: this.previewCanvas?.width || 0,
        height: this.previewCanvas?.height || 0,
      },
      geometryLocked: !!this.geometryLocked,
      wallZones: this.wallZones,
      excludeZones: this.excludeZones,
    };
  }

  _exportZones() {
    const payload = this._zonesPayload();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = 'paint-zones.json';
    a.click();
    URL.revokeObjectURL(url);
    this.toast('Zones exported');
  }

  _importZonesFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result || '{}'));
        const walls = Array.isArray(data.wallZones) ? data.wallZones : [];
        const ex = Array.isArray(data.excludeZones) ? data.excludeZones : [];
        this.wallZones = walls.map((poly) => poly.map((p) => ({ x: Number(p.x), y: Number(p.y) })));
        this.excludeZones = ex.map((poly) => poly.map((p) => ({ x: Number(p.x), y: Number(p.y) })));
        this.geometryLocked = !!data.geometryLocked;
        this.currentZonePoints = [];
        this._setZoneMode('none');
        this._setWorkflowStep(this.geometryLocked ? 'color' : 'zone');
        this._drawGeometryOverlay();
        this._rebuildMaskFromGeometry();
        this.recolorPreview();
        this.toast(`Zones imported (${this.wallZones.length} wall, ${this.excludeZones.length} no-draw)`);
      } catch (err) {
        this.toast(`Invalid zones JSON: ${err.message}`);
      }
    };
    reader.readAsText(file);
  }

  _rebuildMaskFromGeometry() {
    if (!this.maskCtx || !this.maskCanvas) return;
    const w = this.maskCanvas.width;
    const h = this.maskCanvas.height;
    this.maskCtx.clearRect(0, 0, w, h);

    this.maskCtx.save();
    this.maskCtx.fillStyle = 'rgba(20,149,255,1)';
    this.wallZones.forEach((poly) => {
      if (!poly || poly.length < 3) return;
      this.maskCtx.beginPath();
      this.maskCtx.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i += 1) this.maskCtx.lineTo(poly[i].x, poly[i].y);
      this.maskCtx.closePath();
      this.maskCtx.fill();
    });

    this.maskCtx.globalCompositeOperation = 'destination-out';
    this.excludeZones.forEach((poly) => {
      if (!poly || poly.length < 3) return;
      this.maskCtx.beginPath();
      this.maskCtx.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i += 1) this.maskCtx.lineTo(poly[i].x, poly[i].y);
      this.maskCtx.closePath();
      this.maskCtx.fill();
    });
    this.maskCtx.restore();
  }

  _drawAt(x, y) {
    if (this.workflowStep !== 'zone') return;
    const brush = Number(this.brushInput.value || 26);

    this.maskCtx.globalCompositeOperation = this.currentTool === 'erase' ? 'destination-out' : 'source-over';
    this.maskCtx.fillStyle = this.currentTool === 'erase' ? 'rgba(0,0,0,1)' : 'rgba(20,149,255,1)';

    this.maskCtx.beginPath();
    this.maskCtx.arc(x, y, brush / 2, 0, Math.PI * 2);
    this.maskCtx.fill();

    this.recolorPreview();
  }

  _autoFillFrom(x, y) {
    if (this.workflowStep !== 'zone') return;
    if (!this.originalImageData) return;

    const w = this.maskCanvas.width;
    const h = this.maskCanvas.height;
    const px = Math.max(0, Math.min(w - 1, Math.round(x)));
    const py = Math.max(0, Math.min(h - 1, Math.round(y)));

    const base = this.originalImageData.data;
    const seedIdx = (py * w + px) * 4;
    const sr = base[seedIdx];
    const sg = base[seedIdx + 1];
    const sb = base[seedIdx + 2];

    const toleranceRaw = Number(this.toleranceInput?.value || 16);
    // Make low-end less jumpy: 0-20 stays very strict, high end still available.
    const tolerance = Math.pow(toleranceRaw / 80, 2.2) * 48;
    const toleranceSq = tolerance * tolerance * 3;

    const maskImage = this.maskCtx.getImageData(0, 0, w, h);
    const mask = maskImage.data;
    const visited = new Uint8Array(w * h);
    const queue = new Int32Array(w * h);

    let head = 0;
    let tail = 0;
    queue[tail++] = py * w + px;

    const shouldUseWallOnly = this.wallOnlyInput?.checked ?? true;
    const edgeLock = this.edgeLockInput?.checked ?? true;
    const edgeThreshold = 220;
    let changed = 0;

    while (head < tail) {
      const p = queue[head++];
      if (visited[p]) continue;
      visited[p] = 1;

      const ix = p % w;
      const iy = (p / w) | 0;
      const i = (iy * w + ix) * 4;

      const r = base[i];
      const g = base[i + 1];
      const b = base[i + 2];

      if (edgeLock) {
        const e = edgeStrength(base, i, w, h, ix, iy);
        if (e > edgeThreshold) continue;
      }

      if (colorDistanceSq(r, g, b, sr, sg, sb) > toleranceSq) continue;
      if (shouldUseWallOnly && !isLikelyWallPixel(r, g, b, 95, 0.45)) continue;

      mask[i] = 20;
      mask[i + 1] = 149;
      mask[i + 2] = 255;
      mask[i + 3] = 255;
      changed += 1;

      if (ix > 0) queue[tail++] = p - 1;
      if (ix < w - 1) queue[tail++] = p + 1;
      if (iy > 0) queue[tail++] = p - w;
      if (iy < h - 1) queue[tail++] = p + w;
    }

    this.maskCtx.putImageData(maskImage, 0, 0);
    this.toast(changed ? `Auto-filled ${changed.toLocaleString()} px` : 'No region found. Increase tolerance and tap wall again.');
  }
}
