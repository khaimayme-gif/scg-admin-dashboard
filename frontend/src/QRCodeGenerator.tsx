import { useState, useEffect, useRef } from 'react';
import QRCodeStyling from 'qr-code-styling';
import { apiFetch, jsonBody } from './api';
import sochicLogo from './assets/sochic-logo-pink.png';

type CardTheme = 'polka' | 'original' | 'heart';
type DotColor = 'white' | 'black' | 'pink' | 'blue' | 'yellow';

// Brand colors, matching the Quotation PNG template so every export looks like one family.
const BG = '#fffafc';
const DOT = '#ffdeeb';
const PINK = '#da7282';

const CARD_THEMES: Record<CardTheme, string> = {
  polka: 'Polka Dot',
  original: 'Original',
  heart: 'Heart',
};

// History rows saved before the themes changed used 'white' (plain card) and 'bow'.
const LEGACY_THEMES: Record<string, CardTheme> = { white: 'original', bow: 'original' };

const DOT_COLORS: Record<DotColor, { label: string; hex: string }> = {
  white: { label: 'White', hex: '#FFFFFF' },
  black: { label: 'Black', hex: '#1A1A1A' },
  pink: { label: 'Pink', hex: PINK },
  blue: { label: 'Blue', hex: '#2F6FDB' },
  yellow: { label: 'Yellow', hex: '#F2B705' },
};

const BRAND_HANDLE = '@sochicgifts';

// Every theme renders onto the same square canvas, so preview and download always match exactly.
const FRAME_SIZE = 400;
const MARGIN = 24;
const INNER = FRAME_SIZE - MARGIN * 2; // the square area themes decorate, before the caption strip
const CAPTION_HEIGHT = 64;
const CARD_QR_PADDING = 36; // polka: gap between the square's edge and the QR
const CARD_RADIUS = 32;

// Heart theme: a normal scannable QR sits in the middle of a heart that is filled with
// decorative modules on the same grid. The heart outline is the classic parametric curve
// (x = 16 sin^3 t, y = 13 cos t - 5 cos 2t - 2 cos 3t - cos 4t), in units of 1 = 1/32 of its width.
const HEART_FRAME_W = 800;
const HEART_FRAME_H = 740;
const HEART_UNIT = (HEART_FRAME_W - 40) / 32;
const HEART_ORIGIN_Y = 20 + 12 * HEART_UNIT; // canvas y of heart-curve y = 0
const HEART_QR_HALF = 6; // half the QR's side, in heart units
const HEART_QR_CENTER_Y = -2; // QR centre, in heart units (negative = below the origin)

interface Layout {
  width: number;
  height: number;
  qrX: number;
  qrY: number;
  qrSize: number;
  card?: { x: number; y: number; w: number; h: number };
  heart?: boolean;
}

function getLayout(theme: CardTheme, showHandle: boolean): Layout {
  if (theme === 'original') {
    return { width: FRAME_SIZE, height: FRAME_SIZE, qrX: 0, qrY: 0, qrSize: FRAME_SIZE };
  }
  if (theme === 'heart') {
    const qrSize = HEART_QR_HALF * 2 * HEART_UNIT;
    return {
      width: HEART_FRAME_W,
      height: HEART_FRAME_H,
      qrX: HEART_FRAME_W / 2 - qrSize / 2,
      qrY: HEART_ORIGIN_Y - HEART_QR_CENTER_Y * HEART_UNIT - qrSize / 2,
      qrSize,
      heart: true,
    };
  }
  const height = MARGIN + INNER + MARGIN + (showHandle ? CAPTION_HEIGHT : 0);
  const qrSize = INNER - CARD_QR_PADDING * 2;
  return {
    width: FRAME_SIZE,
    height,
    qrX: MARGIN + CARD_QR_PADDING,
    qrY: MARGIN + CARD_QR_PADDING,
    qrSize,
    card: { x: MARGIN, y: MARGIN, w: INNER, h: INNER },
  };
}

function heartPath(): Path2D {
  const path = new Path2D();
  for (let i = 0; i <= 240; i++) {
    const t = (i / 240) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    const px = HEART_FRAME_W / 2 + x * HEART_UNIT;
    const py = HEART_ORIGIN_Y - y * HEART_UNIT;
    if (i === 0) path.moveTo(px, py);
    else path.lineTo(px, py);
  }
  path.closePath();
  return path;
}

// Small deterministic generator so the same link always gets the same heart pattern.
function seededRandom(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 100000) / 100000;
  };
}

// Fills the heart with QR-looking modules on the same grid as the real QR (cells line up with
// it), leaving a one-module quiet gap around the QR so scanners still find it.
function drawHeartModules(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  moduleCount: number,
  color: string,
  seed: string
) {
  const cell = layout.qrSize / moduleCount;
  const path = heartPath();
  const rand = seededRandom(seed);
  const cols = Math.ceil(layout.width / cell) + 2;
  const rows = Math.ceil(layout.height / cell) + 2;
  const offX = layout.qrX % cell;
  const offY = layout.qrY % cell;
  const grid = new Map<string, boolean>();
  const key = (cx: number, cy: number) => `${cx},${cy}`;

  for (let cy = -1; cy < rows; cy++) {
    for (let cx = -1; cx < cols; cx++) {
      const x = offX + cx * cell;
      const y = offY + cy * cell;
      const midX = x + cell / 2;
      const midY = y + cell / 2;
      const nearQr =
        midX > layout.qrX - cell * 1.5 && midX < layout.qrX + layout.qrSize + cell * 1.5 &&
        midY > layout.qrY - cell * 1.5 && midY < layout.qrY + layout.qrSize + cell * 1.5;
      const dark = rand() < 0.5; // always consume one number so the pattern doesn't shift
      if (nearQr || !ctx.isPointInPath(path, midX, midY)) continue;
      if (dark) grid.set(key(cx, cy), true);
    }
  }

  ctx.fillStyle = color;
  const r = cell * 0.5;
  for (const k of grid.keys()) {
    const [cx, cy] = k.split(',').map(Number);
    const up = grid.has(key(cx, cy - 1));
    const down = grid.has(key(cx, cy + 1));
    const left = grid.has(key(cx - 1, cy));
    const right = grid.has(key(cx + 1, cy));
    const x = offX + cx * cell;
    const y = offY + cy * cell;
    // A corner is rounded only where both of its neighbours are empty, so touching modules
    // merge into the soft blobs of the QR style.
    const tl = !up && !left ? r : 0;
    const tr = !up && !right ? r : 0;
    const br = !down && !right ? r : 0;
    const bl = !down && !left ? r : 0;
    ctx.beginPath();
    ctx.moveTo(x + tl, y);
    ctx.lineTo(x + cell - tr, y);
    ctx.arcTo(x + cell, y, x + cell, y + tr, tr);
    ctx.lineTo(x + cell, y + cell - br);
    ctx.arcTo(x + cell, y + cell, x + cell - br, y + cell, br);
    ctx.lineTo(x + bl, y + cell);
    ctx.arcTo(x, y + cell, x, y + cell - bl, bl);
    ctx.lineTo(x, y + tl);
    ctx.arcTo(x, y, x + tl, y, tl);
    ctx.closePath();
    ctx.fill();
  }
}

const roundRectPath = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

// Draws everything except the QR itself: the polka dots and white card, the heart's decorative
// modules, and the optional @sochicgifts caption. The live QR canvas from qr-code-styling is
// layered on top separately, at the position getLayout() returns, both on screen and when
// exporting. Original and Heart stay transparent so only the QR itself is exported.
function drawBackground(
  ctx: CanvasRenderingContext2D,
  theme: CardTheme,
  showHandle: boolean,
  layout: Layout,
  heart: { moduleCount: number; color: string; seed: string } | null
) {
  ctx.clearRect(0, 0, layout.width, layout.height);

  if (theme === 'heart') {
    if (heart) drawHeartModules(ctx, layout, heart.moduleCount, heart.color, heart.seed);
    return;
  }
  if (theme === 'original') return;

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, layout.width, layout.height);

  for (let ty = 0; ty < MARGIN + INNER + MARGIN; ty += 36) {
    ctx.fillStyle = DOT;
    for (let tx = 0; tx < layout.width; tx += 36) {
      ctx.beginPath();
      ctx.arc(tx + 9, ty + 9, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(tx + 27, ty + 27, 4.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (layout.card) {
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.15)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 4;
    ctx.fillStyle = '#FFFFFF';
    roundRectPath(ctx, layout.card.x, layout.card.y, layout.card.w, layout.card.h, CARD_RADIUS);
    ctx.fill();
    ctx.restore();
  }

  if (showHandle) {
    ctx.fillStyle = PINK;
    ctx.font = '600 17px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(BRAND_HANDLE, layout.width / 2, MARGIN + INNER + MARGIN + CAPTION_HEIGHT / 2 + 6);
  }
}

function buildQrOptions(color: string, data: string, size: number, margin: number) {
  return {
    width: size,
    height: size,
    data,
    margin,
    qrOptions: { errorCorrectionLevel: 'H' as const },
    image: sochicLogo,
    imageOptions: { hideBackgroundDots: true, imageSize: 0.36, margin: 5 },
    dotsOptions: { type: 'rounded' as const, color },
    cornersSquareOptions: { type: 'extra-rounded' as const, color },
    cornersDotOptions: { type: 'dot' as const, color },
    backgroundOptions: { color: 'transparent' },
  };
}

interface QrHistoryItem {
  id: number;
  url: string;
  label: string | null;
  card_theme: CardTheme | 'white' | 'bow' | null;
  dot_color: DotColor | null;
  show_handle: boolean | null;
  created_at: string;
}

export default function QRCodeGenerator() {
  const [urlInput, setUrlInput] = useState('');
  const [labelInput, setLabelInput] = useState('');
  const [cardTheme, setCardTheme] = useState<CardTheme>('original');
  const [dotColor, setDotColor] = useState<DotColor>('black');
  const [showHandle, setShowHandle] = useState(false);
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [history, setHistory] = useState<QrHistoryItem[]>([]);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [moduleCount, setModuleCount] = useState(0);

  const qrContainerRef = useRef<HTMLDivElement>(null);
  const qrInstanceRef = useRef<QRCodeStyling | null>(null);
  const bgCanvasRef = useRef<HTMLCanvasElement>(null);

  const layout = getLayout(cardTheme, showHandle);
  // Heart modules line up with the QR grid, so the QR must run edge to edge there; the quiet gap
  // comes from the heart pattern leaving a margin of empty cells around it.
  const qrMargin = cardTheme === 'heart' ? 0 : cardTheme === 'original' ? 16 : 6;

  // The preview is a fixed-size frame; shrink it to fit narrow screens.
  const fitRef = useRef<HTMLDivElement>(null);
  const [fitScale, setFitScale] = useState(1);
  useEffect(() => {
    const el = fitRef.current;
    if (!el) return;
    const update = () => setFitScale(Math.min(1, el.clientWidth / layout.width));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [layout.width]);

  // Create the QR instance once, append it to the container.
  useEffect(() => {
    qrInstanceRef.current = new QRCodeStyling(buildQrOptions(DOT_COLORS[dotColor].hex, ' ', layout.qrSize, qrMargin));
    if (qrContainerRef.current) {
      qrInstanceRef.current.append(qrContainerRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-render the QR whenever the resolved URL, color, or size (which depends on the theme) changes.
  useEffect(() => {
    if (!qrInstanceRef.current || !resolvedUrl) return;
    qrInstanceRef.current.update(buildQrOptions(DOT_COLORS[dotColor].hex, resolvedUrl, layout.qrSize, qrMargin));
    setModuleCount(qrInstanceRef.current._qr?.getModuleCount() ?? 0);
  }, [resolvedUrl, dotColor, layout.qrSize, qrMargin]);

  // Redraw the background canvas whenever the theme, caption toggle, or bow image readiness changes.
  useEffect(() => {
    const canvas = bgCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const heart = resolvedUrl && moduleCount
      ? { moduleCount, color: DOT_COLORS[dotColor].hex, seed: resolvedUrl }
      : null;
    drawBackground(ctx, cardTheme, showHandle, layout, heart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardTheme, showHandle, moduleCount, dotColor, resolvedUrl, layout.width, layout.height]);

  const loadHistory = async () => {
    try {
      const res = await apiFetch('/qr/history');
      if (res.ok) setHistory(await res.json());
    } catch {
      // silent - history is a nice-to-have, not critical path
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const handleGenerate = () => {
    if (!urlInput.trim()) {
      setErrorMsg('Enter a website address first.');
      setStatus('error');
      return;
    }
    setErrorMsg('');
    setStatus('idle');
    const target = /^https?:\/\//i.test(urlInput.trim()) ? urlInput.trim() : `https://${urlInput.trim()}`;
    setResolvedUrl(target);
  };

  const handleSave = async () => {
    if (!resolvedUrl) return;
    setStatus('saving');
    try {
      await apiFetch('/qr/save', jsonBody({
        url: resolvedUrl,
        label: labelInput.trim() || null,
        cardTheme,
        dotColor,
        showHandle,
      }));
      setStatus('saved');
      setLabelInput('');
      await loadHistory();
      setTimeout(() => setStatus('idle'), 2000);
    } catch {
      setErrorMsg('Could not save this QR code.');
      setStatus('error');
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await apiFetch(`/qr/history/${id}`, { method: 'DELETE' });
    } catch {
      return;
    }
    await loadHistory();
  };

  const handleLoadFromHistory = (item: QrHistoryItem) => {
    setUrlInput(item.url.replace(/^https?:\/\//, ''));
    if (item.card_theme) setCardTheme(LEGACY_THEMES[item.card_theme] ?? item.card_theme);
    if (item.dot_color) setDotColor(item.dot_color);
    setShowHandle(!!item.show_handle);
    setResolvedUrl(item.url);
  };

  const handleDownload = () => {
    if (!resolvedUrl || !qrContainerRef.current) return;
    const qrCanvas = qrContainerRef.current.querySelector('canvas');
    const bg = bgCanvasRef.current;
    if (!qrCanvas || !bg) return;

    const canvas = document.createElement('canvas');
    canvas.width = layout.width;
    canvas.height = layout.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(bg, 0, 0);
    ctx.drawImage(qrCanvas, layout.qrX, layout.qrY, layout.qrSize, layout.qrSize);

    canvas.toBlob((blob) => {
      if (!blob) return;
      const objectUrl = URL.createObjectURL(blob);
      const name = resolvedUrl.replace(/https?:\/\//, '').replace(/[^\w.-]/g, '-');
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `qr-${name}.png`;
      a.click();
      URL.revokeObjectURL(objectUrl);
    }, 'image/png');
  };

  return (
    <div className="page">
      <header className="page-header">
        <h1>QR Code Generator</h1>
        <p className="page-subtitle">Turn a customer's digital website link into a scannable QR code.</p>
      </header>

      <div className="calc-layout">
        <section className="calc-panel">
          <h2 className="panel-label">Website link</h2>

          <div className="item-rows">
            <input
              type="text"
              placeholder="dearmiki.sochicgifts.com"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              className="item-input item-input-name"
              style={{ width: '100%' }}
            />
          </div>

          <h2 className="panel-label" style={{ marginTop: 20 }}>Theme</h2>
          <div className="view-toggle">
            {(Object.keys(CARD_THEMES) as CardTheme[]).map((id) => (
              <button
                key={id}
                type="button"
                className={`view-toggle-btn ${cardTheme === id ? 'is-active' : ''}`}
                onClick={() => setCardTheme(id)}
              >
                {CARD_THEMES[id]}
              </button>
            ))}
          </div>

          <h2 className="panel-label" style={{ marginTop: 20 }}>QR color</h2>
          <div className="theme-picker">
            {(Object.keys(DOT_COLORS) as DotColor[]).map((id) => (
              <button
                key={id}
                type="button"
                className={`theme-swatch ${dotColor === id ? 'is-active' : ''}`}
                style={{ background: DOT_COLORS[id].hex }}
                onClick={() => setDotColor(id)}
                aria-label={DOT_COLORS[id].label}
                title={DOT_COLORS[id].label}
              />
            ))}
          </div>

          {cardTheme === 'polka' && (
            <label className="frame-toggle">
              <input
                type="checkbox"
                checked={showHandle}
                onChange={(e) => setShowHandle(e.target.checked)}
              />
              Add {BRAND_HANDLE} (optional)
            </label>
          )}

          <button className="calculate-btn" onClick={handleGenerate} style={{ marginTop: 12 }}>
            Generate QR code
          </button>

          {status === 'error' && <p className="error-text">{errorMsg}</p>}

          {history.length > 0 && (
            <>
              <h2 className="panel-label" style={{ marginTop: 28 }}>History</h2>
              <div className="qr-history-list">
                {history.map((item) => (
                  <div className="qr-history-row" key={item.id}>
                    <button className="qr-history-load" onClick={() => handleLoadFromHistory(item)}>
                      <div className="qr-history-url">{item.label || item.url}</div>
                      {item.label && <div className="qr-history-sub">{item.url}</div>}
                    </button>
                    <button className="item-remove" onClick={() => handleDelete(item.id)} aria-label="Delete">×</button>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="calc-panel calc-result-panel">
          <h2 className="panel-label">Preview</h2>

          <div className="qr-fit" ref={fitRef} style={{ height: layout.height * fitScale }}>
          <div className={`qr-stage ${cardTheme !== 'polka' && dotColor === 'white' ? 'is-dark' : ''} ${cardTheme !== 'polka' ? 'is-bare' : ''}`} style={{ width: layout.width, height: layout.height, transform: `scale(${fitScale})`, transformOrigin: 'top left', margin: 0 }}>
            <canvas ref={bgCanvasRef} width={layout.width} height={layout.height} className="qr-bg-canvas" />
            <div
              ref={qrContainerRef}
              className={!resolvedUrl ? 'qr-canvas-hidden' : ''}
              style={{ position: 'absolute', top: layout.qrY, left: layout.qrX, width: layout.qrSize, height: layout.qrSize }}
            />
          </div>
          </div>

          {!resolvedUrl ? (
            <p className="empty-state">Enter a link and generate to see the QR code here.</p>
          ) : (
            <>
              <p className="qr-preview-url">{resolvedUrl}</p>

              <input
                type="text"
                placeholder="Label (e.g. customer name)"
                value={labelInput}
                onChange={(e) => setLabelInput(e.target.value)}
                className="item-input"
                style={{ width: '100%', marginBottom: 10 }}
              />

              <button className="calculate-btn" onClick={handleDownload} style={{ marginBottom: 10 }}>
                Download PNG
              </button>
              <button
                className="save-btn"
                onClick={handleSave}
                disabled={status === 'saving' || status === 'saved'}
              >
                {status === 'saved' ? 'Saved ✓' : status === 'saving' ? 'Saving…' : 'Save to history'}
              </button>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
