import { useEffect, useRef, useState } from 'react';
import { LOVE_NOTE_TEMPLATES, longDate, renderLoveNotePng } from './loveNoteImage';
import { downloadBlob } from './quotationImage';

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// The printed love note that comes free with every order. Pick a template, change the greeting,
// the message and who it is from, then download it or print it. Everything else on the card is fixed.
export default function LoveNotes() {
  const [templateId, setTemplateId] = useState(LOVE_NOTE_TEMPLATES[0].id);
  const template = LOVE_NOTE_TEMPLATES.find((t) => t.id === templateId) ?? LOVE_NOTE_TEMPLATES[0];

  const [greeting, setGreeting] = useState(template.defaultGreeting);
  const [body, setBody] = useState('');
  const [from, setFrom] = useState('');
  const [date, setDate] = useState(todayIso());

  const [previewUrl, setPreviewUrl] = useState('');
  const [overflow, setOverflow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lastUrl = useRef('');

  const text = { greeting, body, from, date: longDate(date) };

  // Redraws the preview shortly after the last keystroke. A smaller image is enough on screen.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      renderLoveNotePng(template, text, 1.5)
        .then(({ blob, overflow: o }) => {
          if (cancelled) return;
          const url = URL.createObjectURL(blob);
          if (lastUrl.current) URL.revokeObjectURL(lastUrl.current);
          lastUrl.current = url;
          setPreviewUrl(url);
          setOverflow(o);
        })
        .catch(() => !cancelled && setError('Could not draw the preview'));
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template, greeting, body, from, date]);

  useEffect(() => () => { if (lastUrl.current) URL.revokeObjectURL(lastUrl.current); }, []);

  const finalPng = async () => {
    setBusy(true);
    setError('');
    try {
      return await renderLoveNotePng(template, text, 3);
    } catch {
      setError('Could not make the image. Please try again.');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const fileName = () => {
    const who = (from || 'card').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'card';
    return `SCG-LoveNote-${who}-${date}.png`;
  };

  const download = async () => {
    const result = await finalPng();
    if (result) downloadBlob(result.blob, fileName());
  };

  const print = async () => {
    const result = await finalPng();
    if (!result) return;
    const url = URL.createObjectURL(result.blob);
    const w = window.open('', '_blank');
    if (!w) {
      setError('Your browser blocked the print window. Allow pop-ups for this site, or use Download.');
      return;
    }
    w.document.write(
      `<!doctype html><title>Love note</title><style>@page{margin:0}html,body{margin:0;height:100%}img{display:block;width:100%;height:100%;object-fit:contain}</style><img src="${url}" onload="setTimeout(function(){window.print()},200)">`
    );
    w.document.close();
  };

  const clear = () => {
    setGreeting(template.defaultGreeting);
    setBody('');
    setFrom('');
  };

  return (
    <div className="page">
      <header className="page-header">
        <h1>Love Notes</h1>
        <p className="page-subtitle">The printed card that comes with every order. Write the message, then download or print it.</p>
      </header>

      <div className="love-note-layout">
        <section className="calc-panel dash-panel love-note-form">
          {LOVE_NOTE_TEMPLATES.length > 1 && (
            <div className="order-field">
              <label>Template</label>
              <select className="item-input" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                {LOVE_NOTE_TEMPLATES.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="order-field">
            <label>Greeting</label>
            <input className="item-input" value={greeting} onChange={(e) => setGreeting(e.target.value)} placeholder={template.defaultGreeting} />
          </div>

          <div className="order-field">
            <label>Message</label>
            <textarea
              className="item-input order-item-details"
              rows={9}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write the love note here…"
            />
            {overflow && <p className="error-text">This message is too long for the card. Shorten it a little.</p>}
          </div>

          <div className="order-field">
            <label>From</label>
            <input className="item-input" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="e.g. Nathan" />
          </div>

          <div className="order-field">
            <label>Date on the card</label>
            <input type="date" className="item-input" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>

          {error && <p className="error-text">{error}</p>}

          <div className="share-actions">
            <button className="new-order-btn" onClick={download} disabled={busy}>{busy ? 'Preparing…' : 'Download'}</button>
            <button className="add-item-btn" onClick={print} disabled={busy}>Print</button>
            <button className="order-edit-btn" onClick={clear} disabled={busy}>Start over</button>
          </div>
        </section>

        <section className="love-note-preview" aria-label="Preview of the card">
          {previewUrl ? <img src={previewUrl} alt="Love note preview" /> : <p className="stat-sub">Drawing the card…</p>}
        </section>
      </div>
    </div>
  );
}
