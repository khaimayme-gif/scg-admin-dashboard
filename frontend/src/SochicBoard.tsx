import { useState, useEffect, useRef } from 'react';
import { apiFetch, jsonBody } from './api';

type Stage = 'todo' | 'in_progress' | 'done' | 'closed';

interface TicketItem {
  name: string;
  quantity: number;
  details?: string;
}

interface Ticket {
  id: number;
  order_no: string | null;
  customer_name: string;
  recipient: string | null;
  country: string;
  status: string;
  currency: string;
  selling_price: number;
  items: TicketItem[];
  delivery_address: string | null;
  delivery_date: string | null;
  order_date: string;
  notes: string | null;
  board_stage: Stage;
  board_position: number;
  comment_count: number;
}

interface Comment {
  id: number;
  body: string;
  created_at: string;
}

const STAGES: { id: Stage; label: string; hint: string }[] = [
  { id: 'todo', label: 'To do', hint: 'Not started' },
  { id: 'in_progress', label: 'In progress', hint: 'Being prepared' },
  { id: 'done', label: 'Done', hint: 'Delivered / finished' },
  { id: 'closed', label: 'Closed', hint: 'Archived' },
];

const PAYMENT_LABELS: Record<string, string> = {
  pending: 'Unpaid',
  partially_paid: 'Partially paid',
  paid: 'Paid',
  cancelled: 'Cancelled',
};

const CLOSED_PAGE = 15;

// How urgent a ticket is, from its delivery date. Only orders still being worked on (To do /
// In progress) get a colour; Done and Closed are calm, and no date means nothing to measure.
type Urgency = 'red' | 'orange' | 'yellow' | 'green' | 'none' | 'finished';
const URGENCY_LEGEND: { id: Urgency; label: string }[] = [
  { id: 'red', label: 'Overdue, today or tomorrow' },
  { id: 'orange', label: '2 to 3 days' },
  { id: 'yellow', label: '4 to 7 days' },
  { id: 'green', label: 'More than a week' },
];
const fmt = (n: number) => Math.round(n).toLocaleString();
const todayLocal = () => new Date().toLocaleDateString('en-CA');

const daysFromToday = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  const [ty, tm, td] = todayLocal().split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86_400_000);
};

const dayLabel = (iso: string) => {
  const diff = daysFromToday(iso);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

const urgencyOf = (t: { board_stage: Stage; delivery_date: string | null }): Urgency => {
  if (t.board_stage === 'done' || t.board_stage === 'closed') return 'finished';
  if (!t.delivery_date) return 'none';
  const days = daysFromToday(t.delivery_date);
  if (days <= 1) return 'red';
  if (days <= 3) return 'orange';
  if (days <= 7) return 'yellow';
  return 'green';
};

const itemsSummary = (items: TicketItem[]) =>
  items.map((it) => (it.quantity > 1 ? `${it.quantity}× ${it.name}` : it.name)).join(', ');

const commentTime = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

interface BoardProps {
  onOpenOrder?: (orderId: number) => void;
  onNewOrder?: () => void;
}

export default function SochicBoard({ onOpenOrder, onNewOrder }: BoardProps) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [mobileStage, setMobileStage] = useState<Stage>('todo');
  const [closedShown, setClosedShown] = useState(CLOSED_PAGE);
  const [openId, setOpenId] = useState<number | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [overStage, setOverStage] = useState<Stage | null>(null);

  const load = () =>
    apiFetch('/board')
      .then((res) => res.json())
      .then((data) => setTickets(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  const query = search.trim().toLowerCase();
  const matches = (t: Ticket) =>
    !query ||
    [t.order_no, t.customer_name, t.recipient, itemsSummary(t.items)].some((v) => (v ?? '').toLowerCase().includes(query));

  // To do / In progress / Done keep the order you put them in; Closed lists the newest first.
  const columnTickets = (stage: Stage) => {
    const list = tickets.filter((t) => t.board_stage === stage);
    return stage === 'closed'
      ? list.sort((a, b) => b.board_position - a.board_position)
      : list.sort((a, b) => a.board_position - b.board_position);
  };

  // Moves a ticket, optionally dropping it just before another ticket in the target column.
  const moveTicket = async (id: number, stage: Stage, beforeId?: number) => {
    const target = columnTickets(stage).filter((t) => t.id !== id);
    let position: number;
    if (stage === 'closed') {
      position = Date.now();
    } else if (beforeId !== undefined) {
      const idx = target.findIndex((t) => t.id === beforeId);
      const next = target[idx];
      const prev = target[idx - 1];
      position = next ? (prev ? (prev.board_position + next.board_position) / 2 : next.board_position - 1000) : Date.now();
    } else {
      position = (target[target.length - 1]?.board_position ?? Date.now()) + 1000;
    }
    setTickets((prev) => prev.map((t) => (t.id === id ? { ...t, board_stage: stage, board_position: position } : t)));
    setError('');
    try {
      const res = await apiFetch('/board/move', jsonBody({ orderId: id, stage, position }));
      if (!res.ok) throw new Error('move failed');
    } catch {
      setError('Could not move that ticket. Reloaded the board.');
      load();
    }
  };

  const handleDrop = (stage: Stage, beforeId?: number) => {
    if (dragId !== null) moveTicket(dragId, stage, beforeId);
    setDragId(null);
    setOverStage(null);
  };

  const bumpCount = (id: number, delta: number) =>
    setTickets((prev) => prev.map((t) => (t.id === id ? { ...t, comment_count: Math.max(0, t.comment_count + delta) } : t)));

  const card = (t: Ticket) => {
    const urgency = urgencyOf(t);
    const late = t.delivery_date && (t.board_stage === 'todo' || t.board_stage === 'in_progress') && daysFromToday(t.delivery_date) < 0;
    return (
      <li
        key={t.id}
        className={`ticket urgency-${urgency} ${dragId === t.id ? 'is-dragging' : ''}`}
        draggable
        onDragStart={(e) => { setDragId(t.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(t.id)); }}
        onDragEnd={() => { setDragId(null); setOverStage(null); }}
        onDragOver={(e) => { if (dragId !== null) e.preventDefault(); }}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleDrop(t.board_stage, t.id); }}
      >
        <button className="ticket-body" onClick={() => setOpenId(t.id)}>
          <span className="ticket-top">
            <span className="ticket-id">{t.order_no ?? `#${t.id}`}</span>
            <span className={`status-pill status-${t.status}`}>{PAYMENT_LABELS[t.status] ?? t.status}</span>
          </span>
          <span className="ticket-title">
            {t.customer_name}
            {t.recipient && t.recipient !== t.customer_name ? ` → ${t.recipient}` : ''}
          </span>
          <span className="ticket-items">{itemsSummary(t.items) || 'No items'}</span>
          <span className="ticket-foot">
            {t.delivery_date ? (
              <span className={`ticket-date ${late ? 'is-late' : ''}`}>{late ? 'Overdue · ' : ''}{dayLabel(t.delivery_date)}</span>
            ) : (
              <span className="ticket-date is-none">No delivery date</span>
            )}
            {t.comment_count > 0 && <span className="ticket-comments">💬 {t.comment_count}</span>}
          </span>
        </button>
        <select
          className="ticket-move"
          value=""
          onChange={(e) => e.target.value && moveTicket(t.id, e.target.value as Stage)}
          aria-label={`Move ${t.order_no ?? t.customer_name} to another column`}
        >
          <option value="">Move to…</option>
          {STAGES.filter((s) => s.id !== t.board_stage).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </li>
    );
  };

  const opened = openId === null ? null : tickets.find((t) => t.id === openId) ?? null;

  return (
    <div className="page board-page">
      <header className="page-header page-header-row">
        <div>
          <h1>So Chic Board</h1>
          <p className="page-subtitle">Every order as a ticket. Drag it along as it moves from to do to closed.</p>
        </div>
        <button className="new-order-btn" onClick={onNewOrder}>New Order</button>
      </header>

      <div className="board-tools">
        <ul className="urgency-legend" aria-label="Card colours">
          {URGENCY_LEGEND.map((u) => (
            <li key={u.id}><span className={`urgency-dot urgency-${u.id}`} />{u.label}</li>
          ))}
        </ul>
        <input className="item-input board-search" placeholder="Search customer, order ID or item…" value={search}
          onChange={(e) => setSearch(e.target.value)} />
      </div>

      {error && <p className="error-text">{error}</p>}

      {loading ? (
        <p className="empty-state">Loading…</p>
      ) : (
        <>
          <div className="board-tabs" role="tablist">
            {STAGES.map((s) => (
              <button key={s.id} role="tab" aria-selected={mobileStage === s.id}
                className={`board-tab ${mobileStage === s.id ? 'is-active' : ''}`} onClick={() => setMobileStage(s.id)}>
                {s.label} <span>{tickets.filter((t) => t.board_stage === s.id && matches(t)).length}</span>
              </button>
            ))}
          </div>

          <div className="board">
            {STAGES.map((s) => {
              const all = columnTickets(s.id).filter(matches);
              const shown = s.id === 'closed' && !query ? all.slice(0, closedShown) : all;
              return (
                <section
                  key={s.id}
                  className={`board-col ${mobileStage === s.id ? 'is-mobile-active' : ''} ${overStage === s.id ? 'is-over' : ''}`}
                  onDragOver={(e) => { if (dragId !== null) { e.preventDefault(); setOverStage(s.id); } }}
                  onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverStage(null); }}
                  onDrop={(e) => { e.preventDefault(); handleDrop(s.id); }}
                >
                  <div className="board-col-head">
                    <h2>{s.label}</h2>
                    <span className="board-count">{all.length}</span>
                  </div>
                  <ul className="board-list">
                    {shown.map(card)}
                    {all.length === 0 && <li className="board-empty">{query ? 'No matches' : s.hint}</li>}
                  </ul>
                  {s.id === 'closed' && !query && all.length > closedShown && (
                    <button className="add-item-btn board-more" onClick={() => setClosedShown((n) => n + CLOSED_PAGE)}>
                      Show more ({all.length - closedShown})
                    </button>
                  )}
                </section>
              );
            })}
          </div>
        </>
      )}

      {opened && (
        <TicketModal
          ticket={opened}
          onClose={() => setOpenId(null)}
          onMove={(stage) => moveTicket(opened.id, stage)}
          onOpenOrder={onOpenOrder}
          onCountChange={(delta) => bumpCount(opened.id, delta)}
        />
      )}
    </div>
  );
}

function TicketModal({ ticket, onClose, onMove, onOpenOrder, onCountChange }: {
  ticket: Ticket;
  onClose: () => void;
  onMove: (stage: Stage) => void;
  onOpenOrder?: (orderId: number) => void;
  onCountChange: (delta: number) => void;
}) {
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setComments(null);
    apiFetch(`/board/comments/${ticket.id}`)
      .then((res) => res.json())
      .then((data) => setComments(Array.isArray(data) ? data : []))
      .catch(() => setComments([]));
  }, [ticket.id]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [comments?.length]);

  const post = async () => {
    if (!text.trim()) return;
    setPosting(true);
    setError('');
    try {
      const res = await apiFetch('/board/comment', jsonBody({ orderId: ticket.id, body: text }));
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Could not add the comment.');
        return;
      }
      setComments((prev) => [...(prev ?? []), data]);
      onCountChange(1);
      setText('');
    } catch {
      // a 401 has already sent us back to login
    } finally {
      setPosting(false);
    }
  };

  const remove = async (c: Comment) => {
    if (!window.confirm('Delete this comment?')) return;
    try {
      await apiFetch(`/board/comment/${c.id}`, { method: 'DELETE' });
    } catch {
      return;
    }
    setComments((prev) => (prev ?? []).filter((x) => x.id !== c.id));
    onCountChange(-1);
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-card ticket-modal">
        <div className="modal-header">
          <div>
            <span className="ticket-id">{ticket.order_no ?? `#${ticket.id}`}</span>
            <h2 className="ticket-modal-title">{ticket.customer_name}{ticket.recipient && ticket.recipient !== ticket.customer_name ? ` → ${ticket.recipient}` : ''}</h2>
          </div>
          <button className="item-remove" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="ticket-stage-row">
          {STAGES.map((s) => (
            <button key={s.id} className={`stage-btn ${ticket.board_stage === s.id ? 'is-active' : ''}`}
              onClick={() => ticket.board_stage !== s.id && onMove(s.id)}>
              {s.label}
            </button>
          ))}
        </div>

        <dl className="detail-grid">
          <div><dt>Payment</dt><dd><span className={`status-pill status-${ticket.status}`}>{PAYMENT_LABELS[ticket.status] ?? ticket.status}</span></dd></div>
          <div><dt>Total</dt><dd className="items-price-cell">{fmt(ticket.selling_price)} {ticket.currency}</dd></div>
          <div><dt>Delivery date</dt><dd>{ticket.delivery_date ? `${dayLabel(ticket.delivery_date)} · ${ticket.delivery_date}` : '—'}</dd></div>
          <div><dt>Country</dt><dd>{ticket.country || '—'}</dd></div>
          <div className="detail-wide"><dt>Delivery address</dt><dd>{ticket.delivery_address || '—'}</dd></div>
          {ticket.notes && <div className="detail-wide"><dt>Notes</dt><dd>{ticket.notes}</dd></div>}
        </dl>

        <div className="detail-items">
          <span className="detail-label">Items</span>
          <ul>
            {ticket.items.map((it, i) => (
              <li key={i}>
                <span>{it.quantity > 1 ? `${it.quantity}× ` : ''}{it.name}</span>
                {it.details && <small>{it.details}</small>}
              </li>
            ))}
          </ul>
        </div>

        <div className="comments">
          <span className="detail-label">Comments {comments ? `(${comments.length})` : ''}</span>
          <ul className="comment-list">
            {comments === null && <li className="board-empty">Loading…</li>}
            {comments?.length === 0 && <li className="board-empty">No comments yet.</li>}
            {comments?.map((c) => (
              <li key={c.id} className="comment">
                <p>{c.body}</p>
                <span className="comment-meta">
                  {commentTime(c.created_at)}
                  <button className="comment-delete" onClick={() => remove(c)}>Delete</button>
                </span>
              </li>
            ))}
            <div ref={endRef} />
          </ul>
          <textarea className="item-input order-item-details" rows={2} placeholder="Write a comment…" value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) post(); }} />
          {error && <p className="error-text">{error}</p>}
          <div className="order-form-actions">
            <button className="save-btn" onClick={post} disabled={posting || !text.trim()}>{posting ? 'Posting…' : 'Add comment'}</button>
            {onOpenOrder && <button className="add-item-btn" onClick={() => onOpenOrder(ticket.id)}>Open order</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
