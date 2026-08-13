import { useState, useEffect, useRef } from 'react';
import QRCodeStyling from 'qr-code-styling';
import { apiFetch, jsonBody } from './api';
import sochicLogo from './assets/sochic-logo.png';

type ThemeId = 'blossom' | 'rosegold' | 'sage' | 'classic';

const THEMES: Record<ThemeId, { label: string; dotColor: string; swatch: string }> = {
  blossom: { label: 'Blossom Pink', dotColor: '#E8699E', swatch: '#E8699E' },
  rosegold: { label: 'Rose Gold', dotColor: '#9B5A45', swatch: '#B5735A' },
  sage: { label: 'Sage Forest', dotColor: '#33453B', swatch: '#33453B' },
  classic: { label: 'Classic Black', dotColor: '#1A1A1A', swatch: '#1A1A1A' },
};

const BRAND_HANDLE = '@sochicgifts';

// Frame layout constants (all in px, shared between the on-screen preview and the download composite)
const FRAME_WIDTH = 360;
const FRAME_HEIGHT = 430;
const FRAMED_QR_SIZE = 260;
const FRAMED_QR_OFFSET_X = (FRAME_WIDTH - FRAMED_QR_SIZE) / 2;
const FRAMED_QR_OFFSET_Y = 108;
const PLAIN_QR_SIZE = 300;

function buildQrOptions(theme: ThemeId, data: string, size: number) {
  const color = THEMES[theme].dotColor;
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

// Builds the decorative frame (corner brackets, "SCAN ME" banner, brand handle) as an SVG string.
// The QR itself is layered on top separately, both on screen (CSS) and when composited for download (canvas).
function buildFrameSvgMarkup(color: string) {
  const bx = FRAMED_QR_OFFSET_X - 14;
  const by = FRAMED_QR_OFFSET_Y - 14;
  const bw = FRAMED_QR_SIZE + 28;
  const bh = FRAMED_QR_SIZE + 28;
  const armLen = 34;

  const corner = (x: number, y: number, hDir: 1 | -1, vDir: 1 | -1) => `
    <path d="M ${x} ${y + vDir * armLen} L ${x} ${y} L ${x + hDir * armLen} ${y}"
      stroke="${color}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" fill="none" />
  `;

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${FRAME_WIDTH}" height="${FRAME_HEIGHT}" viewBox="0 0 ${FRAME_WIDTH} ${FRAME_HEIGHT}">
  ${corner(bx, by, 1, 1)}
  ${corner(bx + bw, by, -1, 1)}
  ${corner(bx, by + bh, 1, -1)}
  ${corner(bx + bw, by + bh, -1, -1)}

  <path d="M 90 12 h 180 a 14 14 0 0 1 14 14 v 30 a 14 14 0 0 1 -14 14 h -60 l -20 22 l -20 -22 h -80 a 14 14 0 0 1 -14 -14 v -30 a 14 14 0 0 1 14 -14 z"
    fill="${color}" />
  <text x="180" y="55" text-anchor="middle" font-family="Arial, sans-serif" font-size="24" font-weight="700" fill="#FFFFFF" letter-spacing="1">SCAN ME</text>

  <text x="180" y="${by + bh + 34}" text-anchor="middle" font-family="Arial, sans-serif" font-size="15" font-weight="600" fill="${color}" letter-spacing="2">${BRAND_HANDLE.toUpperCase()}</text>
</svg>`.trim();
}

interface QrHistoryItem {
  id: number;
  url: string;
  label: string | null;
  theme: ThemeId | null;
  created_at: string;
}

export default function QRCodeGenerator() {
  const [urlInput, setUrlInput] = useState('');
  const [labelInput, setLabelInput] = useState('');
  const [theme, setTheme] = useState<ThemeId>('blossom');
  const [includeFrame, setIncludeFrame] = useState(false);
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [history, setHistory] = useState<QrHistoryItem[]>([]);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const qrContainerRef = useRef<HTMLDivElement>(null);
  const qrInstanceRef = useRef<QRCodeStyling | null>(null);

  const currentSize = includeFrame ? FRAMED_QR_SIZE : PLAIN_QR_SIZE;

  // Create the QR instance once, append it to the container
  useEffect(() => {
    qrInstanceRef.current = new QRCodeStyling(buildQrOptions(theme, ' ', currentSize));
    if (qrContainerRef.current) {
      qrInstanceRef.current.append(qrContainerRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-render the QR whenever the resolved URL, theme, or frame size changes
  useEffect(() => {
    if (!qrInstanceRef.current || !resolvedUrl) return;
    qrInstanceRef.current.update(buildQrOptions(theme, resolvedUrl, currentSize));
  }, [resolvedUrl, theme, currentSize]);

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
      await apiFetch('/qr/save', jsonBody({ url: resolvedUrl, label: labelInput.trim() || null, theme }));
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
    if (item.theme) setTheme(item.theme);
    setResolvedUrl(item.url);
  };

  const downloadPlain = () => {
    if (!qrInstanceRef.current || !resolvedUrl) return;
    const name = resolvedUrl.replace(/https?:\/\//, '').replace(/[^\w.-]/g, '-');
    qrInstanceRef.current.download({ name: `qr-${name}`, extension: 'png' });
  };

  const downloadFramed = () => {
    if (!qrContainerRef.current || !resolvedUrl) return;
    const qrCanvas = qrContainerRef.current.querySelector('canvas');
    if (!qrCanvas) return;

    const svgMarkup = buildFrameSvgMarkup(THEMES[theme].dotColor);
    const svgDataUrl = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgMarkup)))}`;

    const frameImg = new Image();
    frameImg.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = FRAME_WIDTH;
      canvas.height = FRAME_HEIGHT;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.drawImage(frameImg, 0, 0, FRAME_WIDTH, FRAME_HEIGHT);
      ctx.drawImage(qrCanvas, FRAMED_QR_OFFSET_X, FRAMED_QR_OFFSET_Y, FRAMED_QR_SIZE, FRAMED_QR_SIZE);

      canvas.toBlob((blob) => {
        if (!blob) return;
        const objectUrl = URL.createObjectURL(blob);
        const name = resolvedUrl.replace(/https?:\/\//, '').replace(/[^\w.-]/g, '-');
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = `qr-framed-${name}.png`;
        a.click();
        URL.revokeObjectURL(objectUrl);
      }, 'image/png');
    };
    frameImg.src = svgDataUrl;
  };

  const handleDownload = () => {
    if (includeFrame) downloadFramed();
    else downloadPlain();
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
          <div className="theme-picker">
            {(Object.keys(THEMES) as ThemeId[]).map((id) => (
              <button
                key={id}
                type="button"
                className={`theme-swatch ${theme === id ? 'is-active' : ''}`}
                style={{ background: THEMES[id].swatch }}
                onClick={() => setTheme(id)}
                aria-label={THEMES[id].label}
                title={THEMES[id].label}
              />
            ))}
          </div>

          <label className="frame-toggle">
            <input
              type="checkbox"
              checked={includeFrame}
              onChange={(e) => setIncludeFrame(e.target.checked)}
            />
            Add frame ("SCAN ME" + {BRAND_HANDLE})
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

          <div
            className="qr-stage"
            style={{
              width: includeFrame ? FRAME_WIDTH : PLAIN_QR_SIZE,
              height: includeFrame ? FRAME_HEIGHT : PLAIN_QR_SIZE,
            }}
          >
            {includeFrame && (
              <svg
                className="qr-frame-svg"
                dangerouslySetInnerHTML={{ __html: buildFrameSvgMarkup(THEMES[theme].dotColor).replace(/<\/?svg[^>]*>/g, '') }}
                viewBox={`0 0 ${FRAME_WIDTH} ${FRAME_HEIGHT}`}
                width={FRAME_WIDTH}
                height={FRAME_HEIGHT}
              />
            )}
            <div
              ref={qrContainerRef}
              className={!resolvedUrl ? 'qr-canvas-hidden' : ''}
              style={
                includeFrame
                  ? { position: 'absolute', top: FRAMED_QR_OFFSET_Y, left: FRAMED_QR_OFFSET_X, width: FRAMED_QR_SIZE, height: FRAMED_QR_SIZE }
                  : undefined
              }
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
                Download PNG (transparent)
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