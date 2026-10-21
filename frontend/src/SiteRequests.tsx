import { Fragment, useEffect, useState } from 'react';
import { apiFetch, jsonBody } from './api';

interface Answers {
  occasion: 'birthday' | 'anniversary';
  eventDate: string;
  receiverName: string;
  senderName: string;
  relationStart: string;
  loveMessage: string;
  writeForMe: boolean;
  cakeWishes: string[];
  reasons: string[];
  memories: { photo: string; date: string; caption: string }[];
  letterPhotos: string[];
  couplePhoto: string;
  password: string;
  contact: string;
}

interface RequestRow {
  id: number;
  token: string;
  order_id: number | null;
  order_no: string | null;
  customer_name: string;
  country: string | null;
  status: 'waiting' | 'submitted' | 'site_made';
  answers: Answers | null;
  site_id: number | null;
  created_at: string;
  submitted_at: string | null;
}

interface OrderRow {
  id: number;
  order_no: string | null;
  customer_name: string;
}

const STATUS_LABEL: Record<RequestRow['status'], string> = { waiting: 'Waiting for customer', submitted: 'Answers received', site_made: 'Website made' };
const linkFor = (token: string) => `${window.location.origin}/request/${token}`;
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

// Private links for customers to fill in what they want on their gift website, and the answers that
// come back. "Make website" turns an answer into a draft website in Websites.
export default function SiteRequests({ onOpenSite }: { onOpenSite?: (siteId: number) => void }) {
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [creating, setCreating] = useState(false);
  const [pickOrder, setPickOrder] = useState<number | ''>('');
  const [pickName, setPickName] = useState('');
  const [busy, setBusy] = useState(false);
  const [justMade, setJustMade] = useState<RequestRow | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const load = () =>
    Promise.all([
      apiFetch('/site-requests').then((r) => (r.ok ? r.json() : [])),
      apiFetch('/orders').then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([reqRows, orderRows]) => {
        setRows(Array.isArray(reqRows) ? reqRows : []);
        setOrders(Array.isArray(orderRows) ? orderRows.slice(0, 200) : []);
      })
      .catch(() => setError('Could not load the requests.'))
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

  const create = async () => {
    if (pickOrder === '' && !pickName.trim()) {
      setError('Pick an order or type the customer name.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await apiFetch('/site-requests/create', jsonBody({ orderId: pickOrder === '' ? undefined : pickOrder, customerName: pickName.trim() || undefined }));
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not make the link.');
      setCreating(false);
      setPickOrder('');
      setPickName('');
      setJustMade(data);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not make the link.');
    } finally {
      setBusy(false);
    }
  };

  const copy = async (r: RequestRow) => {
    try {
      await navigator.clipboard.writeText(linkFor(r.token));
      setCopiedId(r.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      window.prompt('Copy this link:', linkFor(r.token));
    }
  };

  const makeSite = async (r: RequestRow) => {
    setBusy(true);
    setError('');
    try {
      const res = await apiFetch('/site-requests/make-site', jsonBody({ id: r.id }));
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not make the website.');
      await load();
      onOpenSite?.(data.siteId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not make the website.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r: RequestRow) => {
    if (!window.confirm(`Delete the request for ${r.customer_name}? Its link will stop working.`)) return;
    try {
      const res = await apiFetch(`/site-requests/delete/${r.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      load();
    } catch {
      setError('Could not delete that request.');
    }
  };

  const waiting = rows.filter((r) => r.status === 'waiting').length;
  const received = rows.filter((r) => r.status === 'submitted').length;

  return (
    <div className="page">
      <header className="page-header page-header-row">
        <div>
          <h1>Website Requests</h1>
          <p className="page-subtitle">Send a customer a private link to fill in what they want on their gift website. Their answers land here.</p>
        </div>
        <button className="new-order-btn" onClick={() => { setCreating(true); setError(''); }}>New request link</button>
      </header>

      <div className="stat-grid">
        <div className="stat-card"><span className="stat-label">Waiting for customer</span><span className="stat-value">{waiting}</span></div>
        <div className="stat-card"><span className="stat-label">Answers to review</span><span className="stat-value">{received}</span></div>
        <div className="stat-card"><span className="stat-label">All requests</span><span className="stat-value">{rows.length}</span></div>
      </div>

      {error && <p className="error-text">{error}</p>}

      {justMade && (
        <div className="calc-panel quote-latest">
          <h2 className="panel-label">Link for {justMade.customer_name}</h2>
          <input className="item-input" readOnly value={linkFor(justMade.token)} onFocus={(e) => e.target.select()} aria-label="Request link" />
          <div className="order-form-actions">
            <button className="save-btn" onClick={() => copy(justMade)}>{copiedId === justMade.id ? 'Copied ✓' : 'Copy link'}</button>
            <button className="add-item-btn" onClick={() => setJustMade(null)}>Done</button>
          </div>
          <p className="stat-sub">Send this to the customer. It only works for this order, and it stops working once the website is made.</p>
        </div>
      )}

      <div className="calc-panel">
        <h2 className="panel-label">All requests</h2>
        {loading ? (
          <p className="empty-state">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="empty-state">No requests yet. Make a link for an order and send it to the customer.</p>
        ) : (
          <div className="orders-table-wrap">
            <table className="items-table orders-compact">
              <thead>
                <tr><th>Customer</th><th>Status</th><th>Sent</th><th></th></tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const open = expanded.has(r.id);
                  const a = r.answers;
                  return (
                    <Fragment key={r.id}>
                      <tr className={open ? 'is-open' : ''}>
                        <td>
                          <span className="cell-main">{r.customer_name}</span>
                          <span className="cell-sub">{r.order_no ?? 'No order linked'}</span>
                        </td>
                        <td><span className={`status-pill ${r.status === 'site_made' ? 'status-paid' : ''}`}>{STATUS_LABEL[r.status]}</span></td>
                        <td><span className="cell-sub">{day(r.submitted_at ?? r.created_at)}</span></td>
                        <td className="row-action-cell">
                          <button className={`details-btn ${open ? 'is-open' : ''}`} onClick={() => toggle(r.id)} aria-expanded={open}>
                            Details<span className="details-caret" aria-hidden="true">▾</span>
                          </button>
                        </td>
                      </tr>
                      {open && (
                        <tr className="detail-row">
                          <td colSpan={4}>
                            <div className="order-detail">
                              {a ? (
                                <>
                                  <dl className="detail-grid">
                                    <div><dt>Occasion</dt><dd>{a.occasion === 'anniversary' ? 'Anniversary' : 'Birthday'}</dd></div>
                                    <div><dt>Opens on</dt><dd>{a.eventDate}</dd></div>
                                    <div><dt>For</dt><dd>{a.receiverName}</dd></div>
                                    <div><dt>From</dt><dd>{a.senderName}</dd></div>
                                    <div><dt>Together since</dt><dd>{a.relationStart}</dd></div>
                                    <div><dt>QR password they chose</dt><dd>{a.password || '—'}</dd></div>
                                    <div className="detail-wide"><dt>Love message</dt><dd>{a.loveMessage || 'They asked us to write it'}</dd></div>
                                  </dl>
                                  <div className="req-admin-photos">
                                    {[...a.memories.map((m) => m.photo), ...a.letterPhotos, a.couplePhoto].filter(Boolean).map((u, i) => (
                                      <a key={i} href={u} target="_blank" rel="noreferrer"><img src={u} alt="" /></a>
                                    ))}
                                  </div>
                                  <p className="stat-sub">
                                    Cake wishes: {a.cakeWishes.filter(Boolean).length} · Reasons: {a.reasons.filter(Boolean).length} (empty ones keep the template's own wording)
                                  </p>
                                </>
                              ) : (
                                <p className="stat-sub">The customer has not sent their answers yet.</p>
                              )}
                              <div className="detail-actions">
                                {r.status !== 'site_made' && (
                                  <button className="add-item-btn" onClick={() => copy(r)}>{copiedId === r.id ? 'Copied ✓' : 'Copy link'}</button>
                                )}
                                {r.status === 'submitted' && <button className="save-btn" onClick={() => makeSite(r)} disabled={busy}>{busy ? 'Making…' : 'Make website'}</button>}
                                {r.status === 'site_made' && r.site_id && onOpenSite && <button className="save-btn" onClick={() => onOpenSite(r.site_id!)}>Open website</button>}
                                <button className="order-edit-btn danger-link" onClick={() => remove(r)}>Delete</button>
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
      </div>

      {creating && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <div className="modal-header">
              <h2 className="panel-label">New request link</h2>
              <button className="item-remove" onClick={() => setCreating(false)} aria-label="Close">×</button>
            </div>
            <div className="order-field">
              <label>Order (optional)</label>
              <select className="item-input" value={pickOrder} onChange={(e) => setPickOrder(e.target.value === '' ? '' : Number(e.target.value))}>
                <option value="">No order</option>
                {orders.map((o) => (
                  <option key={o.id} value={o.id}>{o.order_no ?? `#${o.id}`} · {o.customer_name}</option>
                ))}
              </select>
            </div>
            {pickOrder === '' && (
              <div className="order-field">
                <label>Customer name</label>
                <input className="item-input" value={pickName} onChange={(e) => setPickName(e.target.value)} placeholder="Who is this link for?" />
              </div>
            )}
            {error && <p className="error-text">{error}</p>}
            <div className="order-form-actions">
              <button className="save-btn" onClick={create} disabled={busy}>{busy ? 'Making…' : 'Make link'}</button>
              <button className="add-item-btn" onClick={() => setCreating(false)} disabled={busy}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
