import { useState, useEffect, useRef } from 'react';
import QRCodeStyling from 'qr-code-styling';
import { apiFetch, jsonBody } from './api';
import { useRole, lockedCountryOf } from './role';

type Country = 'thailand' | 'japan';
type Filter = 'all' | Country | 'unassigned';

interface SurveyAnswer {
  id: number;
  name: string;
  country: Country | null;
  delivery: 'perfect' | 'minor' | 'problem';
  rating: number;
  feedback: string | null;
  created_at: string;
}

const DELIVERY_LABELS: Record<SurveyAnswer['delivery'], string> = {
  perfect: 'Everything perfect',
  minor: 'Small issue',
  problem: 'There was a problem',
};

const COUNTRY_LABELS: Record<Country, string> = { thailand: 'Thailand', japan: 'Japan' };
const COUNTRIES: Country[] = ['thailand', 'japan'];

const surveyLink = (country: Country) => `${window.location.origin}/survey?c=${country}`;

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);

// The link and a QR code for one country's survey.
function ShareCard({ country }: { country: Country }) {
  const url = surveyLink(country);
  const qrRef = useRef<HTMLDivElement>(null);
  const qrInstance = useRef<QRCodeStyling | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const el = qrRef.current;
    if (!el) return;
    const qr = new QRCodeStyling({
      width: 150,
      height: 150,
      data: url,
      margin: 4,
      qrOptions: { errorCorrectionLevel: 'M' },
      dotsOptions: { type: 'rounded', color: '#DA7282' },
      cornersSquareOptions: { type: 'extra-rounded', color: '#DA7282' },
      cornersDotOptions: { type: 'dot', color: '#DA7282' },
      backgroundOptions: { color: '#ffffff' },
    });
    el.innerHTML = '';
    qr.append(el);
    qrInstance.current = qr;
  }, [url]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt('Copy this link:', url);
    }
  };

  return (
    <div className="share-card">
      <div className="share-qr" ref={qrRef} aria-label={`QR code for the ${COUNTRY_LABELS[country]} survey`} />
      <div className="share-info">
        <span className="detail-label">{COUNTRY_LABELS[country]} survey</span>
        <input className="item-input" readOnly value={url} onFocus={(e) => e.target.select()} aria-label={`${COUNTRY_LABELS[country]} survey link`} />
        <div className="share-actions">
          <button className="add-item-btn" onClick={copy}>{copied ? 'Copied ✓' : 'Copy link'}</button>
          <button className="add-item-btn" onClick={() => qrInstance.current?.download({ name: `survey-${country}`, extension: 'png' })}>
            Download QR
          </button>
          <a className="order-edit-btn" href={url} target="_blank" rel="noreferrer">Open form</a>
        </div>
      </div>
    </div>
  );
}

export default function Feedback() {
  const role = useRole();
  const locked = lockedCountryOf(role); // 'Thailand' | 'Japan' | null (super admin)
  const isSuper = role === 'superadmin';
  const [items, setItems] = useState<SurveyAnswer[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [error, setError] = useState('');

  const load = () =>
    apiFetch('/survey')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setItems(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  const shown = items.filter((r) => filter === 'all' || (filter === 'unassigned' ? r.country === null : r.country === filter));
  const average = shown.length ? shown.reduce((sum, r) => sum + r.rating, 0) / shown.length : 0;
  const perfect = shown.length ? Math.round((shown.filter((r) => r.delivery === 'perfect').length / shown.length) * 100) : 0;
  const problems = shown.filter((r) => r.delivery === 'problem').length;
  const unassignedCount = items.filter((r) => r.country === null).length;

  const assign = async (r: SurveyAnswer, country: Country | null) => {
    setError('');
    try {
      const res = await apiFetch('/survey/country', jsonBody({ id: r.id, country }));
      if (!res.ok) throw new Error();
      setItems((prev) => prev.map((x) => (x.id === r.id ? { ...x, country } : x)));
    } catch {
      setError('Could not change the country.');
    }
  };

  const remove = async (r: SurveyAnswer) => {
    if (!window.confirm(`Delete the answer from ${r.name}?`)) return;
    setError('');
    try {
      const res = await apiFetch(`/survey/delete/${r.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setItems((prev) => prev.filter((x) => x.id !== r.id));
    } catch {
      setError('Could not delete that answer.');
    }
  };

  const shareCountries: Country[] = locked ? [locked.toLowerCase() as Country] : COUNTRIES;

  return (
    <div className="page">
      <header className="page-header">
        <h1>Customer Feedback</h1>
        <p className="page-subtitle">
          What customers say after they receive their order. Send them the survey link or QR code, then match the name with the order.
        </p>
      </header>

      <section className="calc-panel dash-panel">
        <div className="dash-panel-head">
          <h2 className="panel-label">Share the survey</h2>
        </div>
        <div className="share-grid">
          {shareCountries.map((c) => <ShareCard key={c} country={c} />)}
        </div>
        <p className="stat-sub dash-foot">
          Three short questions in Burmese, plus the customer's name. Use the link that matches the order's country so the answer lands in the right place.
        </p>
      </section>

      {isSuper && (
        <div className="view-toggle feedback-filter" role="tablist" aria-label="Country">
          {(['all', 'thailand', 'japan', 'unassigned'] as Filter[]).map((f) => (
            <button
              key={f}
              role="tab"
              aria-selected={filter === f}
              className={`view-toggle-btn ${filter === f ? 'is-active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? 'All' : f === 'unassigned' ? `No country${unassignedCount ? ` (${unassignedCount})` : ''}` : COUNTRY_LABELS[f]}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <p className="empty-state">Loading…</p>
      ) : (
        <>
          <div className="stat-grid">
            <div className="stat-card">
              <span className="stat-label">Answers</span>
              <span className="stat-value">{shown.length}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Average satisfaction</span>
              <span className="stat-value">{shown.length ? average.toFixed(1) : '—'}{shown.length ? ' / 5' : ''}</span>
              {shown.length > 0 && <span className="stat-sub star-line">{stars(Math.round(average))}</span>}
            </div>
            <div className="stat-card">
              <span className="stat-label">Delivered perfectly</span>
              <span className="stat-value">{shown.length ? `${perfect}%` : '—'}</span>
              {problems > 0 && <span className="stat-sub">{problems} reported a problem</span>}
            </div>
          </div>

          {error && <p className="error-text">{error}</p>}

          <section className="calc-panel dash-panel">
            <div className="dash-panel-head">
              <h2 className="panel-label">Answers</h2>
              <span className="items-count">{shown.length} {shown.length === 1 ? 'answer' : 'answers'}</span>
            </div>
            {shown.length === 0 ? (
              <p className="empty-state">No answers yet. Share the survey link after an order is delivered.</p>
            ) : (
              <ul className="feedback-list">
                {shown.map((r) => (
                  <li className={`feedback-item delivery-${r.delivery}`} key={r.id}>
                    <div className="feedback-top">
                      <span className="feedback-name">{r.name}</span>
                      <span className="feedback-stars" aria-label={`${r.rating} out of 5`}>{stars(r.rating)}</span>
                    </div>
                    <div className="feedback-meta">
                      <span className={`delivery-pill delivery-${r.delivery}`}>{DELIVERY_LABELS[r.delivery]}</span>
                      <span>{when(r.created_at)}</span>
                      {isSuper ? (
                        <select
                          className="feedback-country"
                          value={r.country ?? ''}
                          onChange={(e) => assign(r, (e.target.value || null) as Country | null)}
                          aria-label="Country"
                        >
                          <option value="">No country</option>
                          {COUNTRIES.map((c) => <option key={c} value={c}>{COUNTRY_LABELS[c]}</option>)}
                        </select>
                      ) : (
                        r.country && <span>{COUNTRY_LABELS[r.country]}</span>
                      )}
                    </div>
                    {r.feedback && <p className="feedback-text">{r.feedback}</p>}
                    {isSuper && (
                      <button className="comment-delete" onClick={() => remove(r)}>Delete</button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
