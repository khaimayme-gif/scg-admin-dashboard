import { Fragment, useState, useEffect, useRef } from 'react';
import QRCodeStyling from 'qr-code-styling';
import { apiFetch, jsonBody } from './api';
import { useRole } from './role';
import logo from './assets/sochic-logo-pink.png';

// The password page every printed card points to. It lives on the public website, so the QR keeps
// working even if the admin moves. Change it here if the website address ever changes (cards that
// were already printed would then need the old address to keep redirecting).
const GATE_URL = 'https://sochicgifts.vercel.app/open';

type Occasion = 'birthday' | 'anniversary' | 'love' | 'thank_you' | 'apology' | 'graduation' | 'other';
type Country = 'thailand' | 'japan';

interface Note {
  id: number;
  customer_name: string;
  occasion: Occasion;
  password: string;
  destination_url: string;
  country: Country | null;
  order_ref: string | null;
  note: string | null;
  available_from: string | null;
  available_until: string | null;
  opens: number;
  last_opened_at: string | null;
  created_by: string;
  created_at: string;
}

interface FormState {
  id?: number;
  customerName: string;
  occasion: Occasion;
  orderRef: string;
  password: string;
  destinationUrl: string;
  country: Country | '';
  availableFrom: string; // value of a datetime-local input, '' = no start
  availableUntil: string;
  note: string;
}

const OCCASIONS: { id: Occasion; label: string }[] = [
  { id: 'birthday', label: 'Birthday' },
  { id: 'anniversary', label: 'Anniversary' },
  { id: 'love', label: 'Love' },
  { id: 'thank_you', label: 'Thank you' },
  { id: 'apology', label: 'Apology' },
  { id: 'graduation', label: 'Graduation' },
  { id: 'other', label: 'Other' },
];
const OCCASION_LABEL = Object.fromEntries(OCCASIONS.map((o) => [o.id, o.label])) as Record<Occasion, string>;
const COUNTRY_LABEL: Record<Country, string> = { thailand: 'Thailand', japan: 'Japan' };

// datetime-local wants "YYYY-MM-DDTHH:mm" in local time.
const toInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const nowInput = () => toInput(new Date().toISOString());
const plusDays = (from: string, days: number) => {
  const base = from ? new Date(from) : new Date();
  base.setDate(base.getDate() + days);
  return toInput(base.toISOString());
};

const emptyForm = (): FormState => ({
  customerName: '', occasion: 'birthday', orderRef: '', password: '', destinationUrl: '',
  country: '', availableFrom: '', availableUntil: '', note: '',
});

const shortDate = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

type Status = { id: 'live' | 'soon' | 'ended' | 'always'; label: string };
const statusOf = (n: Note): Status => {
  const now = Date.now();
  if (n.available_from && new Date(n.available_from).getTime() > now) return { id: 'soon', label: `Opens ${shortDate(n.available_from)}` };
  if (n.available_until && new Date(n.available_until).getTime() < now) return { id: 'ended', label: `Ended ${shortDate(n.available_until)}` };
  if (n.available_until) return { id: 'live', label: `Live until ${shortDate(n.available_until)}` };
  return { id: 'always', label: 'Live, no end date' };
};

function GateQr() {
  const ref = useRef<HTMLDivElement>(null);
  const qr = useRef<QRCodeStyling | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const options = {
      data: GATE_URL,
      margin: 8,
      qrOptions: { errorCorrectionLevel: 'H' as const },
      image: logo,
      imageOptions: { hideBackgroundDots: true, imageSize: 0.3, margin: 4 },
      dotsOptions: { type: 'rounded' as const, color: '#1A1A1A' },
      cornersSquareOptions: { type: 'extra-rounded' as const, color: '#1A1A1A' },
      cornersDotOptions: { type: 'dot' as const, color: '#1A1A1A' },
      backgroundOptions: { color: '#ffffff' },
    };
    const preview = new QRCodeStyling({ ...options, width: 170, height: 170 });
    if (ref.current) {
      ref.current.innerHTML = '';
      preview.append(ref.current);
    }
    // The download is a big, print-sharp copy of the same code.
    qr.current = new QRCodeStyling({ ...options, width: 1200, height: 1200 });
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(GATE_URL);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt('Copy this link:', GATE_URL);
    }
  };

  return (
    <div className="share-card">
      <div className="share-qr" ref={ref} style={{ width: 170, height: 170 }} aria-label="QR code for the password page" />
      <div className="share-info">
        <span className="detail-label">The QR for every card</span>
        <input className="item-input" readOnly value={GATE_URL} onFocus={(e) => e.target.select()} aria-label="Password page address" />
        <div className="share-actions">
          <button className="add-item-btn" onClick={() => qr.current?.download({ name: 'sochicgifts-card-qr', extension: 'png' })}>Download QR (print size)</button>
          <button className="add-item-btn" onClick={copy}>{copied ? 'Copied ✓' : 'Copy link'}</button>
          <a className="order-edit-btn" href={GATE_URL} target="_blank" rel="noreferrer">Open the page</a>
        </div>
      </div>
    </div>
  );
}

export default function QrNotes() {
  const role = useRole();
  const isSuper = role === 'superadmin';
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [pageError, setPageError] = useState('');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const load = () =>
    apiFetch('/qr-notes')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setNotes(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  const toggle = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const openNew = () => {
    setForm({ ...emptyForm(), availableFrom: nowInput() });
    setError('');
  };

  const openEdit = (n: Note) => {
    setForm({
      id: n.id,
      customerName: n.customer_name,
      occasion: n.occasion,
      orderRef: n.order_ref ?? '',
      password: n.password,
      destinationUrl: n.destination_url,
      country: n.country ?? '',
      availableFrom: toInput(n.available_from),
      availableUntil: toInput(n.available_until),
      note: n.note ?? '',
    });
    setError('');
  };

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((prev) => (prev ? { ...prev, [key]: value } : prev));

  const save = async () => {
    if (!form) return;
    setSaving(true);
    setError('');
    try {
      const res = await apiFetch('/qr-notes/save', jsonBody({
        id: form.id,
        customerName: form.customerName,
        occasion: form.occasion,
        orderRef: form.orderRef,
        password: form.password,
        destinationUrl: form.destinationUrl,
        country: form.country || null,
        availableFrom: form.availableFrom ? new Date(form.availableFrom).toISOString() : null,
        availableUntil: form.availableUntil ? new Date(form.availableUntil).toISOString() : null,
        note: form.note,
      }));
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Could not save the note.');
        return;
      }
      setForm(null);
      await load();
    } catch {
      // a 401 has already sent us back to login
    } finally {
      setSaving(false);
    }
  };

  const remove = async (n: Note) => {
    if (!window.confirm(`Delete the note for ${n.customer_name}? Its card will stop opening anything.`)) return;
    setPageError('');
    try {
      const res = await apiFetch(`/qr-notes/delete/${n.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      load();
    } catch {
      setPageError('Could not delete that note.');
    }
  };

  const copyPassword = async (n: Note) => {
    try {
      await navigator.clipboard.writeText(n.password);
      setCopiedId(n.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      window.prompt('Password:', n.password);
    }
  };

  const live = notes.filter((n) => ['live', 'always'].includes(statusOf(n).id)).length;
  const totalOpens = notes.reduce((sum, n) => sum + n.opens, 0);
  // Which occasions are written most: a quick read on what sells.
  const byOccasion = OCCASIONS.map((o) => ({ ...o, count: notes.filter((n) => n.occasion === o.id).length }))
    .filter((o) => o.count > 0)
    .sort((a, b) => b.count - a.count);
  const topCount = byOccasion[0]?.count ?? 1;

  return (
    <div className="page">
      <header className="page-header page-header-row">
        <div>
          <h1>QR Love Notes</h1>
          <p className="page-subtitle">
            Print the same QR on every card and write a password on each one by hand. The password opens that customer's page.
          </p>
        </div>
        <button className="new-order-btn" onClick={openNew}>New QR Note</button>
      </header>

      <section className="calc-panel dash-panel">
        <div className="dash-panel-head"><h2 className="panel-label">Your card QR</h2></div>
        <GateQr />
        <p className="stat-sub dash-foot">
          Put this QR into your postcard design once and print as many cards as you like. When a customer orders, add a note below
          with the password you will write on their card and the address of their page.
        </p>
      </section>

      <div className="stat-grid">
        <div className="stat-card"><span className="stat-label">Notes</span><span className="stat-value">{notes.length}</span></div>
        <div className="stat-card"><span className="stat-label">Live now</span><span className="stat-value">{live}</span></div>
        <div className="stat-card"><span className="stat-label">Times opened</span><span className="stat-value">{totalOpens}</span></div>
      </div>

      {byOccasion.length > 0 && (
        <section className="calc-panel dash-panel">
          <div className="dash-panel-head"><h2 className="panel-label">By occasion</h2></div>
          <ul className="occasion-bars">
            {byOccasion.map((o) => (
              <li key={o.id}>
                <span className="occasion-name">{o.label}</span>
                <span className="occasion-track"><span className="occasion-fill" style={{ width: `${(o.count / topCount) * 100}%` }} /></span>
                <span className="occasion-count">{o.count}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {pageError && <p className="error-text">{pageError}</p>}

      <section className="calc-panel dash-panel">
        <div className="dash-panel-head">
          <h2 className="panel-label">All notes</h2>
          <span className="items-count">{notes.length} {notes.length === 1 ? 'note' : 'notes'}</span>
        </div>
        {loading ? (
          <p className="empty-state">Loading…</p>
        ) : notes.length === 0 ? (
          <p className="empty-state">No notes yet. Tap “New QR Note” when a customer orders a QR love note.</p>
        ) : (
          <div className="orders-table-wrap">
            <table className="items-table orders-compact notes-compact">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Password</th>
                  <th>Status</th>
                  <th className="num-col">Opened</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {notes.map((n) => {
                  const status = statusOf(n);
                  const isOpen = expanded.has(n.id);
                  return (
                    <Fragment key={n.id}>
                      <tr className={isOpen ? 'is-open' : ''}>
                        <td>
                          <span className="cell-main">{n.customer_name}</span>
                          <span className="cell-sub">{OCCASION_LABEL[n.occasion]}{n.order_ref ? ` · ${n.order_ref}` : ''}</span>
                        </td>
                        <td>
                          <button className="password-chip" onClick={() => copyPassword(n)} title="Copy the password">
                            {copiedId === n.id ? 'Copied ✓' : n.password}
                          </button>
                        </td>
                        <td><span className={`note-status is-${status.id}`}>{status.label}</span></td>
                        <td className="items-price-cell num-col">{n.opens}</td>
                        <td className="row-action-cell">
                          <button className={`details-btn ${isOpen ? 'is-open' : ''}`} onClick={() => toggle(n.id)} aria-expanded={isOpen}>
                            Details <span className="details-caret" aria-hidden="true">▾</span>
                          </button>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="detail-row">
                          <td colSpan={5}>
                            <div className="order-detail">
                              <dl className="detail-grid">
                                <div className="detail-wide">
                                  <dt>Opens this page</dt>
                                  <dd><a href={n.destination_url} target="_blank" rel="noreferrer">{n.destination_url}</a></dd>
                                </div>
                                <div><dt>Available from</dt><dd>{n.available_from ? shortDate(n.available_from) : 'Right away'}</dd></div>
                                <div><dt>Available until</dt><dd>{n.available_until ? shortDate(n.available_until) : 'No end date'}</dd></div>
                                <div><dt>Country</dt><dd>{n.country ? COUNTRY_LABEL[n.country] : '—'}</dd></div>
                                <div><dt>Last opened</dt><dd>{n.last_opened_at ? shortDate(n.last_opened_at) : 'Never'}</dd></div>
                                {n.note && <div className="detail-wide"><dt>Note</dt><dd>{n.note}</dd></div>}
                              </dl>
                              <div className="detail-actions">
                                <button className="save-btn" onClick={() => openEdit(n)}>Edit</button>
                                <button className="order-edit-btn danger-link" onClick={() => remove(n)}>Delete</button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {form && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <div className="modal-header">
              <h2 className="panel-label">{form.id ? 'Edit QR note' : 'New QR note'}</h2>
              <button className="item-remove" onClick={() => setForm(null)} aria-label="Close">×</button>
            </div>

            <div className="order-form-grid">
              <div className="order-field">
                <label>Customer name</label>
                <input className="item-input" value={form.customerName} onChange={(e) => set('customerName', e.target.value)} autoFocus />
              </div>
              <div className="order-field">
                <label>Occasion</label>
                <select className="item-input" value={form.occasion} onChange={(e) => set('occasion', e.target.value as Occasion)}>
                  {OCCASIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
              </div>
              <div className="order-field">
                <label>Order ID (optional)</label>
                <input className="item-input" placeholder="e.g. SCG-20261007-004" value={form.orderRef} onChange={(e) => set('orderRef', e.target.value)} />
              </div>
              {isSuper && (
                <div className="order-field">
                  <label>Country</label>
                  <select className="item-input" value={form.country} onChange={(e) => set('country', e.target.value as Country | '')}>
                    <option value="">Not set</option>
                    <option value="thailand">Thailand</option>
                    <option value="japan">Japan</option>
                  </select>
                </div>
              )}
            </div>

            <div className="order-field" style={{ marginBottom: 14 }}>
              <label>Password to write on the card</label>
              <input
                className="item-input password-input"
                placeholder="e.g. sunflower7"
                value={form.password}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                onChange={(e) => set('password', e.target.value.replace(/\s/g, ''))}
              />
              <p className="stat-sub" style={{ margin: '4px 0 0' }}>6 to 40 letters or numbers, no spaces. Capital letters don't matter. Each password can only be used once.</p>
            </div>

            <div className="order-field" style={{ marginBottom: 14 }}>
              <label>Customer's page address</label>
              <input className="item-input" placeholder="https://dearmya.vercel.app" value={form.destinationUrl} onChange={(e) => set('destinationUrl', e.target.value)} />
            </div>

            <div className="order-form-grid">
              <div className="order-field">
                <label>Available from (empty = right away)</label>
                <input type="datetime-local" className="item-input" value={form.availableFrom} onChange={(e) => set('availableFrom', e.target.value)} />
              </div>
              <div className="order-field">
                <label>Available until (empty = no end)</label>
                <input type="datetime-local" className="item-input" value={form.availableUntil} onChange={(e) => set('availableUntil', e.target.value)} />
              </div>
            </div>
            <div className="until-presets">
              <span className="stat-sub">Until:</span>
              {[[10, '10 days'], [30, '1 month'], [90, '3 months'], [365, '1 year']].map(([days, label]) => (
                <button key={label} type="button" className="preset-btn" onClick={() => set('availableUntil', plusDays(form.availableFrom, Number(days)))}>
                  {label} after the start
                </button>
              ))}
              {form.availableUntil && <button type="button" className="preset-btn" onClick={() => set('availableUntil', '')}>No end</button>}
            </div>

            <div className="order-field" style={{ margin: '14px 0' }}>
              <label>Note (optional, only you see it)</label>
              <input className="item-input" value={form.note} onChange={(e) => set('note', e.target.value)} />
            </div>

            {error && <p className="error-text">{error}</p>}
            <div className="order-form-actions">
              <button className="save-btn" onClick={save} disabled={saving}>{saving ? 'Saving…' : form.id ? 'Save changes' : 'Add note'}</button>
              <button className="add-item-btn" onClick={() => setForm(null)} disabled={saving}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
