import { useState, useEffect, useRef } from 'react';
import QRCodeStyling from 'qr-code-styling';
import { apiFetch, jsonBody } from './api';
import sochicLogo from './assets/sochic-logo.png';
import bowUrl from './assets/quotation-bow.png';

type CardTheme = 'polka' | 'white' | 'bow';
type DotColor = 'white' | 'black' | 'pink';

// Brand colors, matching the Quotation PNG template so every export looks like one family.
const BG = '#fffafc';
const DOT = '#ffdeeb';
const PINK = '#da7282';

const CARD_THEMES: Record<CardTheme, string> = {
  polka: 'Polka Dot',
  white: 'White',
  bow: 'Bow',
};

const DOT_COLORS: Record<DotColor, { label: string; hex: string }> = {
  white: { label: 'White', hex: '#FFFFFF' },
  black: { label: 'Black', hex: '#1A1A1A' },
  pink: { label: 'Pink', hex: PINK },
};

const BRAND_HANDLE = '@sochicgifts';

// Every theme renders onto the same square canvas, so preview and download always match exactly.
const FRAME_SIZE = 400;
const MARGIN = 24;
const INNER = FRAME_SIZE - MARGIN * 2; // the square area themes decorate, before the caption strip
const CAPTION_HEIGHT = 64;
const CARD_QR_PADDING = 36; // polka / white: gap between the square's edge and the QR
const CARD_RADIUS = 32;
const BOW_WIDTH = 180;
const BOW_HEIGHT = (BOW_WIDTH * 213) / 393; // the source bow image is 393x213
const BOW_GAP = 16; // bow: gap between the bow image and the QR below it

interface Layout {
  width: number;
  height: number;
  qrX: number;
  qrY: number;
  qrSize: number;
  bow?: { x: number; y: number; w: number; h: number };
  card?: { x: number; y: number; w: number; h: number };
}

function getLayout(theme: CardTheme, showHandle: boolean): Layout {
  const height = MARGIN + INNER + MARGIN + (showHandle ? CAPTION_HEIGHT : 0);
  if (theme === 'bow') {
    const qrSize = INNER - BOW_HEIGHT - BOW_GAP;
    return {
      width: FRAME_SIZE,
      height,
      qrX: MARGIN + (INNER - qrSize) / 2,
      qrY: MARGIN + BOW_HEIGHT + BOW_GAP,
      qrSize,
      bow: { x: MARGIN + (INNER - BOW_WIDTH) / 2, y: MARGIN, w: BOW_WIDTH, h: BOW_HEIGHT },
    };
  }
  const qrSize = INNER - CARD_QR_PADDING * 2;
  return {
    width: FRAME_SIZE,
    height,
    qrX: MARGIN + CARD_QR_PADDING,
    qrY: MARGIN + CARD_QR_PADDING,
    qrSize,
    card: theme === 'polka' ? { x: MARGIN, y: MARGIN, w: INNER, h: INNER } : undefined,
  };
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

// Draws everything except the QR itself: the background, the polka dots or bow, the white card,
// and the optional @sochicgifts caption. The live QR canvas from qr-code-styling is layered on
// top separately, at the position getLayout() returns, both on screen and when exporting.
function drawBackground(
  ctx: CanvasRenderingContext2D,
  theme: CardTheme,
  showHandle: boolean,
  layout: Layout,
  bowImg: HTMLImageElement | null
) {
  ctx.clearRect(0, 0, layout.width, layout.height);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, layout.width, layout.height);

  if (theme === 'polka') {
    ctx.fillStyle = DOT;
    for (let ty = 0; ty < MARGIN + INNER + MARGIN; ty += 36) {
      for (let tx = 0; tx < layout.width; tx += 36) {
        ctx.beginPath();
        ctx.arc(tx + 9, ty + 9, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(tx + 27, ty + 27, 4.5, 0, Math.PI * 2);
        ctx.fill();
      }
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

  if (theme === 'bow' && layout.bow && bowImg) {
    ctx.drawImage(bowImg, layout.bow.x, layout.bow.y, layout.bow.w, layout.bow.h);
  }

  if (showHandle) {
    ctx.fillStyle = PINK;
    ctx.font = '600 17px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(BRAND_HANDLE, layout.width / 2, MARGIN + INNER + MARGIN + CAPTION_HEIGHT / 2 + 6);
  }
}

function buildQrOptions(color: string, data: string, size: number) {
  return {
    width: size,
    height: size,
    data,
    margin: 6,
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
  card_theme: CardTheme | null;
  dot_color: DotColor | null;
  show_handle: boolean | null;
  created_at: string;
}

export default function QRCodeGenerator() {
  const [urlInput, setUrlInput] = useState('');
  const [labelInput, setLabelInput] = useState('');
  const [cardTheme, setCardTheme] = useState<CardTheme>('white');
  const [dotColor, setDotColor] = useState<DotColor>('black');
  const [showHandle, setShowHandle] = useState(false);
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [history, setHistory] = useState<QrHistoryItem[]>([]);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [bowImg, setBowImg] = useState<HTMLImageElement | null>(null);

  const qrContainerRef = useRef<HTMLDivElement>(null);
  const qrInstanceRef = useRef<QRCodeStyling | null>(null);
  const bgCanvasRef = useRef<HTMLCanvasElement>(null);

  const layout = getLayout(cardTheme, showHandle);

  // Load the bow image once; every theme's background redraw picks it up once it's ready.
  useEffect(() => {
    const img = new Image();
    img.onload = () => setBowImg(img);
    img.src = bowUrl;
  }, []);

  // Create the QR instance once, append it to the container.
  useEffect(() => {
    qrInstanceRef.current = new QRCodeStyling(buildQrOptions(DOT_COLORS[dotColor].hex, ' ', layout.qrSize));
    if (qrContainerRef.current) {
      qrInstanceRef.current.append(qrContainerRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-render the QR whenever the resolved URL, color, or size (which depends on the theme) changes.
  useEffect(() => {
    if (!qrInstanceRef.current || !resolvedUrl) return;
    qrInstanceRef.current.update(buildQrOptions(DOT_COLORS[dotColor].hex, resolvedUrl, layout.qrSize));
  }, [resolvedUrl, dotColor, layout.qrSize]);

  // Redraw the background canvas whenever the theme, caption toggle, or bow image readiness changes.
  useEffect(() => {
    const canvas = bgCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawBackground(ctx, cardTheme, showHandle, layout, bowImg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardTheme, showHandle, bowImg, layout.width, layout.height]);

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
    if (item.card_theme) setCardTheme(item.card_theme);
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

          <label className="frame-toggle">
            <input
              type="checkbox"
              checked={showHandle}
              onChange={(e) => setShowHandle(e.target.checked)}
            />
            Add {BRAND_HANDLE} (optional)
          </label>

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

          <div className="qr-stage" style={{ width: layout.width, height: layout.height }}>
            <canvas ref={bgCanvasRef} width={layout.width} height={layout.height} className="qr-bg-canvas" />
            <div
              ref={qrContainerRef}
              className={!resolvedUrl ? 'qr-canvas-hidden' : ''}
              style={{ position: 'absolute', top: layout.qrY, left: layout.qrX, width: layout.qrSize, height: layout.qrSize }}
            />
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
