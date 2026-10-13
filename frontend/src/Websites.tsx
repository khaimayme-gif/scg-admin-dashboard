import { Fragment, useState, useEffect, useRef } from 'react';
import QRCodeStyling from 'qr-code-styling';
import { apiFetch, jsonBody } from './api';
import { useRole } from './role';
import type { QrNoteIntent } from './QrNotes';

// The public website that customers' gift pages are shown on: <SITE>/g/<address>.
const SITE = 'https://sochicgifts.vercel.app';
const linkFor = (slug: string) => `${SITE}/g/${slug}`;

type FieldType = 'text' | 'textarea' | 'date' | 'datetime' | 'number' | 'boolean' | 'color' | 'image' | 'audio' | 'video' | 'youtube' | 'url';

interface Field {
  id: string;
  group: string;
  label: string;
  type: FieldType;
  value: string | number | boolean;
  hint?: string;
  advanced?: boolean;
}

interface TemplateInfo {
  file: string;
  name: string;
  occasion: string;
  sites: number;
  recent: number;
  views: number;
  previewUrl: string;
}

interface SiteRow {
  id: number;
  slug: string;
  template: string;
  customer_name: string;
  order_id: number | null;
  order_no: string | null;
  country: 'thailand' | 'japan' | null;
  published: boolean;
  available_from: string | null;
  available_until: string | null;
  note: string | null;
  views: number;
  last_viewed_at: string | null;
  created_by: string;
  created_at: string;
}

interface OrderRow {
  id: number;
  order_no: string | null;
  customer_name: string;
  country: string;
  order_date: string;
}

type Values = Record<string, string | number | boolean>;

interface EditorStart {
  id?: number;
  template: string;
  customerName: string;
  orderId: number | null;
  slug?: string;
  published: boolean;
  availableFrom: string;
  availableUntil: string;
  note: string;
  country: 'thailand' | 'japan' | '';
  values: Values;
}

// ---------------------------------------------------------------- small helpers

const shortDate = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const toInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const plusDays = (from: string, days: number) => {
  const base = from ? new Date(from) : new Date();
  base.setDate(base.getDate() + days);
  return toInput(base.toISOString());
};

type Status = { id: 'draft' | 'soon' | 'live' | 'ended'; label: string };
const statusOf = (s: { published: boolean; available_from: string | null; available_until: string | null }): Status => {
  if (!s.published) return { id: 'draft', label: 'Draft' };
  const now = Date.now();
  if (s.available_from && new Date(s.available_from).getTime() > now) return { id: 'soon', label: `Opens ${shortDate(s.available_from)}` };
  if (s.available_until && new Date(s.available_until).getTime() < now) return { id: 'ended', label: `Ended ${shortDate(s.available_until)}` };
  return { id: 'live', label: s.available_until ? `Live until ${shortDate(s.available_until)}` : 'Live' };
};

// Paste any YouTube link (watch, share or shorts) and it becomes the embed address the page needs.
const youtubeEmbed = (raw: string) => {
  const m = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/.exec(raw.trim());
  return m ? `https://www.youtube.com/embed/${m[1]}` : raw;
};

const assetSrc = (v: string) => (/^(https?:|data:)/i.test(v) ? v : `${SITE}/${v.replace(/^(\.\.\/)+/, '')}`);

// Shrinks a photo to at most 1600px and re-saves it as JPEG so pages stay quick to open.
function compressImage(file: File, maxSide = 1600, quality = 0.85): Promise<File> {
  if (file.type === 'image/gif') return Promise.resolve(file);
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Could not read that picture'));
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((b) => (b ? resolve(new File([b], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' })) : reject(new Error('Could not read that picture'))), 'image/jpeg', quality);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that picture'));
    };
    img.src = url;
  });
}

function putFile(url: string, file: File, onProgress: (pct: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.setRequestHeader('cache-control', 'max-age=31536000');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error('Upload failed. Check your connection and try again.'));
    xhr.send(file);
  });
}

// ---------------------------------------------------------------- one field of the editor

function AssetInput({ field, value, onChange }: { field: Field; value: string; onChange: (v: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [error, setError] = useState('');
  const isImage = field.type === 'image';

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    setPct(0);
    try {
      const upload = isImage ? await compressImage(file) : file;
      const res = await apiFetch('/sites/upload-url', jsonBody({ fileName: upload.name, contentType: upload.type, size: upload.size }));
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not start the upload.');
      await putFile(data.uploadUrl, upload, setPct);
      onChange(data.publicUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setPct(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="asset-input">
      {value && (isImage ? <img className="asset-thumb" src={assetSrc(value)} alt="" /> : <audio className="asset-audio" controls src={assetSrc(value)} />)}
      <div className="asset-controls">
        <input className="item-input" value={value} placeholder="Paste an address, or upload" onChange={(e) => onChange(e.target.value)} />
        <input ref={fileRef} type="file" hidden accept={isImage ? 'image/*' : 'audio/*'} onChange={(e) => pick(e.target.files?.[0])} />
        <button type="button" className="add-item-btn" onClick={() => fileRef.current?.click()} disabled={pct !== null}>
          {pct !== null ? `${pct}%` : 'Upload'}
        </button>
      </div>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

function FieldInput({ field, value, onChange }: { field: Field; value: string | number | boolean; onChange: (v: string | number | boolean) => void }) {
  const text = String(value ?? '');
  switch (field.type) {
    case 'textarea':
      return <textarea className="item-input order-item-details" rows={Math.min(10, Math.max(3, Math.ceil(text.length / 50)))} value={text} onChange={(e) => onChange(e.target.value)} />;
    case 'date':
      return <input type="date" className="item-input" value={text} onChange={(e) => onChange(e.target.value)} />;
    case 'datetime':
      return <input type="datetime-local" className="item-input" value={text} onChange={(e) => onChange(e.target.value)} />;
    case 'number':
      return <input type="number" className="item-input" value={text} onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))} />;
    case 'boolean':
      return (
        <label className="frame-toggle" style={{ marginTop: 0 }}>
          <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} /> On
        </label>
      );
    case 'color':
      return (
        <div className="color-input">
          <input type="color" value={/^#[0-9a-f]{6}$/i.test(text) ? text : '#ffffff'} onChange={(e) => onChange(e.target.value)} aria-label="Pick a colour" />
          <input className="item-input" value={text} onChange={(e) => onChange(e.target.value)} />
        </div>
      );
    case 'image':
    case 'audio':
      return <AssetInput field={field} value={text} onChange={onChange} />;
    case 'youtube':
      return <input className="item-input" value={text} placeholder="Paste the YouTube link" onChange={(e) => onChange(youtubeEmbed(e.target.value))} />;
    default:
      return <input className="item-input" value={text} onChange={(e) => onChange(e.target.value)} />;
  }
}

// ---------------------------------------------------------------- the editor

// The QR love note a website would get, so it can be created with one click.
const occasionOf = (text: string): QrNoteIntent['occasion'] => {
  const t = text.toLowerCase();
  if (t.includes('birthday')) return 'birthday';
  if (t.includes('anniversary')) return 'anniversary';
  if (t.includes('graduat')) return 'graduation';
  if (t.includes('thank')) return 'thank_you';
  if (t.includes('sorry') || t.includes('apolog')) return 'apology';
  if (t.includes('love')) return 'love';
  return 'other';
};

function Editor({ start, templates, orders, onClose, onSaved, onCreateQrNote }: {
  start: EditorStart;
  templates: TemplateInfo[];
  orders: OrderRow[];
  onClose: () => void;
  onSaved: () => void;
  onCreateQrNote?: (intent: QrNoteIntent) => void;
}) {
  const isSuper = useRole() === 'superadmin';
  const [id, setId] = useState<number | undefined>(start.id);
  const [slug, setSlug] = useState(start.slug ?? '');
  const [customerName, setCustomerName] = useState(start.customerName);
  const [orderId, setOrderId] = useState<number | null>(start.orderId);
  const [published, setPublished] = useState(start.published);
  const [from, setFrom] = useState(start.availableFrom);
  const [until, setUntil] = useState(start.availableUntil);
  const [note, setNote] = useState(start.note);
  const [country, setCountry] = useState(start.country);
  const [values, setValues] = useState<Values>(start.values);

  const [fields, setFields] = useState<Field[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [html, setHtml] = useState('');
  const [rendering, setRendering] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false); // changes made since the last save
  const markDirty = () => {
    setSaved(false);
    setDirty(true);
  };
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');
  const [copied, setCopied] = useState(false);
  const qrRef = useRef<HTMLDivElement>(null);
  const qr = useRef<QRCodeStyling | null>(null);

  const template = templates.find((t) => t.file === start.template);

  useEffect(() => {
    apiFetch(`/sites/fields?template=${encodeURIComponent(start.template)}`)
      .then((res) => res.json().then((d) => ({ ok: res.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) throw new Error(d.error || 'Could not read the template.');
        setFields(d.fields);
        const firstGroup = d.fields.find((f: Field) => !f.advanced)?.group;
        setOpenGroups(new Set(firstGroup ? [firstGroup] : []));
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'Could not read the template.'));
  }, [start.template]);

  // The preview is rebuilt a moment after you stop typing.
  useEffect(() => {
    if (!fields) return;
    setRendering(true);
    const timer = setTimeout(() => {
      apiFetch('/sites/render', jsonBody({ template: start.template, values }))
        .then((res) => res.json())
        .then((d) => d.html && setHtml(d.html))
        .catch(() => {})
        .finally(() => setRendering(false));
    }, 600);
    return () => clearTimeout(timer);
  }, [fields, values, start.template]);

  // QR for the finished page, shown once the site exists.
  useEffect(() => {
    if (!slug || !qrRef.current) return;
    const code = new QRCodeStyling({
      width: 120, height: 120, data: linkFor(slug), margin: 4,
      dotsOptions: { type: 'rounded', color: '#1A1A1A' }, backgroundOptions: { color: '#ffffff' },
    });
    qrRef.current.innerHTML = '';
    code.append(qrRef.current);
    qr.current = new QRCodeStyling({
      width: 1000, height: 1000, data: linkFor(slug), margin: 8,
      dotsOptions: { type: 'rounded', color: '#1A1A1A' }, backgroundOptions: { color: '#ffffff' },
    });
  }, [slug]);

  const byId = new Map((fields ?? []).map((f) => [f.id, f]));
  const valueOf = (f: Field) => (f.id in values ? values[f.id] : f.value);
  const setValue = (f: Field, v: string | number | boolean) => {
    markDirty();
    setValues((prev) => {
      const next = { ...prev };
      if (String(v) === String(f.value)) delete next[f.id];
      else next[f.id] = v;
      return next;
    });
  };
  const changedCount = Object.keys(values).filter((k) => byId.has(k)).length;

  const q = search.trim().toLowerCase();
  const matches = (f: Field) => !q || `${f.label} ${f.group} ${String(f.value)} ${String(values[f.id] ?? '')}`.toLowerCase().includes(q);
  const grouped = (advanced: boolean) => {
    const map = new Map<string, Field[]>();
    for (const f of fields ?? []) {
      if (Boolean(f.advanced) !== advanced || !matches(f)) continue;
      map.set(f.group, [...(map.get(f.group) ?? []), f]);
    }
    return [...map.entries()];
  };

  const toggleGroup = (g: string) =>
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });

  const save = async () => {
    setError('');
    if (!customerName.trim()) return setError('Enter the customer name.');
    setSaving(true);
    try {
      const res = await apiFetch('/sites/save', jsonBody({
        id, slug: id ? slug : undefined, template: start.template, customerName, orderId, country: country || null,
        values, published, note,
        availableFrom: from ? new Date(from).toISOString() : null,
        availableUntil: until ? new Date(until).toISOString() : null,
      }));
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setError(data.error || 'Could not save the website.');
      setId(data.id);
      setSlug(data.slug);
      setSaved(true);
      setDirty(false);
      onSaved();
    } catch {
      // a 401 has already sent us back to login
    } finally {
      setSaving(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(linkFor(slug));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      window.prompt('Copy this link:', linkFor(slug));
    }
  };

  const status = statusOf({ published, available_from: from ? new Date(from).toISOString() : null, available_until: until ? new Date(until).toISOString() : null });

  const renderGroup = ([group, list]: [string, Field[]]) => {
    const open = openGroups.has(group) || Boolean(q);
    const changed = list.filter((f) => f.id in values).length;
    return (
      <section className="field-group" key={group}>
        <button type="button" className="field-group-head" onClick={() => toggleGroup(group)} aria-expanded={open}>
          <span>{group}</span>
          <span className="field-group-meta">{changed > 0 && <b>{changed} changed</b>}{list.length} {list.length === 1 ? 'field' : 'fields'} <i className={open ? 'is-open' : ''}>▾</i></span>
        </button>
        {open && (
          <div className="field-group-body">
            {list.map((f) => (
              <div className={`site-field ${f.id in values ? 'is-changed' : ''}`} key={f.id}>
                <label>{f.label}{f.id in values && <button type="button" className="field-reset" onClick={() => { markDirty(); setValues((p) => { const n = { ...p }; delete n[f.id]; return n; }); }}>Reset</button>}</label>
                <FieldInput field={f} value={valueOf(f)} onChange={(v) => setValue(f, v)} />
                {f.hint && <p className="stat-sub" style={{ margin: '3px 0 0' }}>{f.hint}</p>}
              </div>
            ))}
          </div>
        )}
      </section>
    );
  };

  return (
    <div className="site-editor">
      <header className="site-editor-bar">
        <button className="add-item-btn" onClick={onClose}>← Back</button>
        <div className="site-editor-title">
          <strong>{customerName || 'New website'}</strong>
          <span>{template?.name ?? start.template}</span>
        </div>
        <span className={`note-status is-${status.id === 'draft' ? 'ended' : status.id}`}>{status.label}</span>
        <button className="new-order-btn" onClick={save} disabled={saving}>{saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save'}</button>
      </header>

      <div className="site-editor-tabs">
        <button className={tab === 'edit' ? 'is-active' : ''} onClick={() => setTab('edit')}>Edit</button>
        <button className={tab === 'preview' ? 'is-active' : ''} onClick={() => setTab('preview')}>Preview</button>
      </div>

      <div className="site-editor-body">
        <div className={`site-editor-form ${tab === 'edit' ? 'is-shown' : ''}`}>
          {error && <p className="error-text">{error}</p>}

          <section className="calc-panel site-settings">
            <h2 className="panel-label">This website</h2>
            <div className="order-form-grid">
              <div className="order-field">
                <label>Customer name</label>
                <input className="item-input" value={customerName} onChange={(e) => { setCustomerName(e.target.value); markDirty(); }} />
              </div>
              <div className="order-field">
                <label>Order</label>
                <select className="item-input" value={orderId ?? ''} onChange={(e) => { const v = e.target.value ? Number(e.target.value) : null; setOrderId(v); markDirty(); const o = orders.find((x) => x.id === v); if (o && !customerName) setCustomerName(o.customer_name); }}>
                  <option value="">Not linked</option>
                  {orders.map((o) => <option key={o.id} value={o.id}>{o.order_no ?? `#${o.id}`} · {o.customer_name}</option>)}
                </select>
              </div>
              {isSuper && (
                <div className="order-field">
                  <label>Country</label>
                  <select className="item-input" value={country} onChange={(e) => { setCountry(e.target.value as typeof country); markDirty(); }}>
                    <option value="">Not set</option>
                    <option value="thailand">Thailand</option>
                    <option value="japan">Japan</option>
                  </select>
                </div>
              )}
              {id && (
                <div className="order-field">
                  <label>Address ending</label>
                  <input className="item-input" value={slug} onChange={(e) => { setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')); markDirty(); }} />
                </div>
              )}
            </div>

            <label className="frame-toggle publish-toggle">
              <input type="checkbox" checked={published} onChange={(e) => { setPublished(e.target.checked); markDirty(); }} />
              Published: visitors can open the link{published ? '' : ' (off = only you can preview it)'}
            </label>
            <div className="order-form-grid">
              <div className="order-field">
                <label>Available from (empty = right away)</label>
                <input type="datetime-local" className="item-input" value={from} onChange={(e) => { setFrom(e.target.value); markDirty(); }} />
              </div>
              <div className="order-field">
                <label>Available until (empty = no end)</label>
                <input type="datetime-local" className="item-input" value={until} onChange={(e) => { setUntil(e.target.value); markDirty(); }} />
              </div>
            </div>
            <div className="until-presets">
              <span className="stat-sub">Until:</span>
              {([[10, '10 days'], [30, '1 month'], [90, '3 months'], [365, '1 year']] as [number, string][]).map(([days, label]) => (
                <button key={label} type="button" className="preset-btn" onClick={() => { setUntil(plusDays(from, days)); markDirty(); }}>{label} after the start</button>
              ))}
              {until && <button type="button" className="preset-btn" onClick={() => { setUntil(''); markDirty(); }}>No end</button>}
            </div>
            <div className="order-field" style={{ marginTop: 12 }}>
              <label>Note (only you see it)</label>
              <input className="item-input" value={note} onChange={(e) => { setNote(e.target.value); markDirty(); }} />
            </div>

            {id && slug && (
              <div className="site-link">
                <div ref={qrRef} className="share-qr" style={{ width: 120, height: 120 }} />
                <div className="share-info">
                  <span className="detail-label">Link to share with the customer</span>
                  <input className="item-input" readOnly value={linkFor(slug)} onFocus={(e) => e.target.select()} />
                  <div className="share-actions">
                    <button className="add-item-btn" onClick={copy}>{copied ? 'Copied ✓' : 'Copy link'}</button>
                    <button className="add-item-btn" onClick={() => qr.current?.download({ name: `website-${slug}`, extension: 'png' })}>Download QR</button>
                    <a className="order-edit-btn" href={linkFor(slug)} target="_blank" rel="noreferrer">Open</a>
                  </div>
                  {onCreateQrNote && (
                    <button
                      type="button"
                      className="save-btn qr-note-btn"
                      disabled={dirty}
                      title={dirty ? 'Save your changes first' : ''}
                      onClick={() => onCreateQrNote({
                        customerName,
                        orderRef: orders.find((o) => o.id === orderId)?.order_no ?? '',
                        destinationUrl: linkFor(slug),
                        availableFrom: from ? new Date(from).toISOString() : null,
                        availableUntil: until ? new Date(until).toISOString() : null,
                        country,
                        occasion: occasionOf(`${template?.occasion ?? ''} ${template?.name ?? ''}`),
                      })}
                    >
                      Create QR note for the card
                    </button>
                  )}
                  {!published && <p className="stat-sub" style={{ margin: 0 }}>Turn on “Published” and save, or the customer will see a “not available” page.</p>}
                </div>
              </div>
            )}
          </section>

          <section className="calc-panel site-fields">
            <div className="dash-panel-head">
              <h2 className="panel-label">What to change</h2>
              <span className="items-count">{changedCount} changed</span>
            </div>
            {loadError && <p className="error-text">{loadError}</p>}
            {!fields && !loadError && <p className="empty-state">Reading the template…</p>}
            {fields && (
              <>
                <input className="item-input" placeholder="Search fields, e.g. name, pin, photo…" value={search} onChange={(e) => setSearch(e.target.value)} />
                <div className="field-groups">
                  {grouped(false).map(renderGroup)}
                  {grouped(false).length === 0 && <p className="empty-state">Nothing matches “{search}”.</p>}
                </div>
                {grouped(true).length > 0 && (
                  <Fragment>
                    <h3 className="order-subheading" style={{ marginTop: 20 }}>More page text</h3>
                    <p className="stat-sub" style={{ marginTop: 0 }}>Buttons, headings and other words written directly on the page.</p>
                    <div className="field-groups">{grouped(true).map(renderGroup)}</div>
                  </Fragment>
                )}
              </>
            )}
          </section>
        </div>

        <div className={`site-editor-preview ${tab === 'preview' ? 'is-shown' : ''}`}>
          <div className="phone-frame">
            {html ? <iframe title="Preview" srcDoc={html} sandbox="allow-scripts allow-popups allow-forms" /> : <p className="empty-state" style={{ padding: 24 }}>Preview loads here…</p>}
          </div>
          <p className="stat-sub preview-note">{rendering ? 'Updating the preview…' : 'Live preview. The customer sees this page on their phone.'}</p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- the page

export default function Websites({ onCreateQrNote }: { onCreateQrNote?: (intent: QrNoteIntent) => void }) {
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [picking, setPicking] = useState(false);
  const [pickSearch, setPickSearch] = useState('');
  const [pickTemplate, setPickTemplate] = useState('');
  const [pickOrder, setPickOrder] = useState<number | ''>('');
  const [pickName, setPickName] = useState('');
  const [editor, setEditor] = useState<EditorStart | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [error, setError] = useState('');

  const load = () =>
    Promise.all([
      apiFetch('/sites').then((r) => (r.ok ? r.json() : [])),
      apiFetch('/sites/templates').then((r) => r.json().then((d) => (r.ok ? d : Promise.reject(new Error(d.error))))),
      apiFetch('/orders').then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([siteRows, tpl, orderRows]) => {
        setSites(Array.isArray(siteRows) ? siteRows : []);
        setTemplates(Array.isArray(tpl) ? tpl : []);
        setOrders(Array.isArray(orderRows) ? orderRows.slice(0, 200) : []);
        setLoadError('');
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'Could not load the websites.'))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  const nameOf = (file: string) => templates.find((t) => t.file === file)?.name ?? file;

  const startNew = () => {
    setPicking(true);
    setPickSearch('');
    setPickTemplate('');
    setPickOrder('');
    setPickName('');
  };

  const begin = () => {
    if (!pickTemplate) return;
    setPicking(false);
    setEditor({
      template: pickTemplate, customerName: pickName.trim(), orderId: pickOrder === '' ? null : pickOrder,
      published: false, availableFrom: '', availableUntil: '', note: '', country: '', values: {},
    });
  };

  const openSite = async (s: SiteRow) => {
    setError('');
    try {
      const res = await apiFetch(`/sites/get/${s.id}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Could not open the website.');
      setEditor({
        id: d.id, slug: d.slug, template: d.template, customerName: d.customer_name, orderId: d.order_id,
        published: d.published, availableFrom: toInput(d.available_from), availableUntil: toInput(d.available_until),
        note: d.note ?? '', country: d.country ?? '', values: d.values ?? {},
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open the website.');
    }
  };

  const remove = async (s: SiteRow) => {
    if (!window.confirm(`Delete the website for ${s.customer_name}? Its link will stop working.`)) return;
    setError('');
    try {
      const res = await apiFetch(`/sites/delete/${s.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      load();
    } catch {
      setError('Could not delete that website.');
    }
  };

  const copyLink = async (s: SiteRow) => {
    try {
      await navigator.clipboard.writeText(linkFor(s.slug));
      setCopiedId(s.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      window.prompt('Copy this link:', linkFor(s.slug));
    }
  };

  const toggle = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const live = sites.filter((s) => statusOf(s).id === 'live').length;
  const totalViews = sites.reduce((sum, s) => sum + s.views, 0);
  const ranking = [...templates].filter((t) => t.sites > 0).sort((a, b) => b.sites - a.sites || b.views - a.views).slice(0, 8);
  const topSites = ranking[0]?.sites ?? 1;

  const visibleTemplates = templates.filter((t) => !pickSearch.trim() || `${t.name} ${t.occasion}`.toLowerCase().includes(pickSearch.trim().toLowerCase()));

  if (editor) {
    return (
      <Editor
        key={editor.id ?? 'new'}
        start={editor}
        templates={templates}
        orders={orders}
        onClose={() => { setEditor(null); load(); }}
        onSaved={load}
        onCreateQrNote={onCreateQrNote}
      />
    );
  }

  return (
    <div className="page">
      <header className="page-header page-header-row">
        <div>
          <h1>Websites</h1>
          <p className="page-subtitle">
            Make a customer's gift website from a template: fill in their names, photos and dates, preview it, then publish and share the link.
          </p>
        </div>
        <button className="new-order-btn" onClick={startNew}>New Website</button>
      </header>

      {loadError && <p className="error-text">{loadError}</p>}
      {error && <p className="error-text">{error}</p>}

      <div className="stat-grid">
        <div className="stat-card"><span className="stat-label">Websites</span><span className="stat-value">{sites.length}</span></div>
        <div className="stat-card"><span className="stat-label">Live now</span><span className="stat-value">{live}</span></div>
        <div className="stat-card"><span className="stat-label">Times opened</span><span className="stat-value">{totalViews}</span></div>
      </div>

      {ranking.length > 0 && (
        <section className="calc-panel dash-panel">
          <div className="dash-panel-head">
            <h2 className="panel-label">Best-selling templates</h2>
            <span className="items-count">websites made</span>
          </div>
          <ul className="occasion-bars template-bars">
            {ranking.map((t, i) => (
              <li key={t.file}>
                <span className="occasion-name"><b>{i + 1}.</b> {t.name}</span>
                <span className="occasion-track"><span className="occasion-fill" style={{ width: `${(t.sites / topSites) * 100}%` }} /></span>
                <span className="occasion-count" title={`${t.recent} in the last 30 days, opened ${t.views} times`}>{t.sites}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="calc-panel dash-panel">
        <div className="dash-panel-head">
          <h2 className="panel-label">All websites</h2>
          <span className="items-count">{sites.length} {sites.length === 1 ? 'website' : 'websites'}</span>
        </div>
        {loading ? (
          <p className="empty-state">Loading…</p>
        ) : sites.length === 0 ? (
          <p className="empty-state">No websites yet. Tap “New Website” when a customer's order is confirmed.</p>
        ) : (
          <div className="orders-table-wrap">
            <table className="items-table orders-compact notes-compact">
              <thead>
                <tr><th>Customer</th><th>Template</th><th>Status</th><th className="num-col">Opened</th><th></th></tr>
              </thead>
              <tbody>
                {sites.map((s) => {
                  const status = statusOf(s);
                  const isOpen = expanded.has(s.id);
                  return (
                    <Fragment key={s.id}>
                      <tr className={isOpen ? 'is-open' : ''}>
                        <td><span className="cell-main">{s.customer_name}</span><span className="cell-sub">{s.order_no ?? 'No order linked'}</span></td>
                        <td><span className="cell-main">{nameOf(s.template)}</span></td>
                        <td><span className={`note-status is-${status.id === 'draft' ? 'ended' : status.id}`}>{status.label}</span></td>
                        <td className="items-price-cell num-col">{s.views}</td>
                        <td className="row-action-cell">
                          <button className={`details-btn ${isOpen ? 'is-open' : ''}`} onClick={() => toggle(s.id)} aria-expanded={isOpen}>
                            Details <span className="details-caret" aria-hidden="true">▾</span>
                          </button>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="detail-row">
                          <td colSpan={5}>
                            <div className="order-detail">
                              <dl className="detail-grid">
                                <div className="detail-wide"><dt>Link</dt><dd><a href={linkFor(s.slug)} target="_blank" rel="noreferrer">{linkFor(s.slug)}</a></dd></div>
                                <div><dt>Available from</dt><dd>{s.available_from ? shortDate(s.available_from) : 'Right away'}</dd></div>
                                <div><dt>Available until</dt><dd>{s.available_until ? shortDate(s.available_until) : 'No end date'}</dd></div>
                                <div><dt>Last opened</dt><dd>{s.last_viewed_at ? shortDate(s.last_viewed_at) : 'Never'}</dd></div>
                                <div><dt>Created</dt><dd>{shortDate(s.created_at)}</dd></div>
                                {s.note && <div className="detail-wide"><dt>Note</dt><dd>{s.note}</dd></div>}
                              </dl>
                              <div className="detail-actions">
                                <button className="save-btn" onClick={() => openSite(s)}>Edit</button>
                                <button className="add-item-btn" onClick={() => copyLink(s)}>{copiedId === s.id ? 'Copied ✓' : 'Copy link'}</button>
                                {onCreateQrNote && (
                                  <button className="add-item-btn" onClick={() => {
                                    const t = templates.find((x) => x.file === s.template);
                                    onCreateQrNote({
                                      customerName: s.customer_name,
                                      orderRef: s.order_no ?? '',
                                      destinationUrl: linkFor(s.slug),
                                      availableFrom: s.available_from,
                                      availableUntil: s.available_until,
                                      country: s.country ?? '',
                                      occasion: occasionOf(`${t?.occasion ?? ''} ${t?.name ?? ''}`),
                                    });
                                  }}>Create QR note</button>
                                )}
                                <button className="order-edit-btn danger-link" onClick={() => remove(s)}>Delete</button>
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

      {picking && (
        <div className="modal-backdrop">
          <div className="modal-card pick-card">
            <div className="modal-header">
              <h2 className="panel-label">New website</h2>
              <button className="item-remove" onClick={() => setPicking(false)} aria-label="Close">×</button>
            </div>
            <p className="stat-sub" style={{ marginTop: 0 }}>1. Choose the template to copy. The original is never changed.</p>
            <input className="item-input" placeholder="Search templates…" value={pickSearch} onChange={(e) => setPickSearch(e.target.value)} />
            <div className="template-grid">
              {visibleTemplates.map((t) => (
                <button key={t.file} type="button" className={`template-pick ${pickTemplate === t.file ? 'is-picked' : ''}`} onClick={() => setPickTemplate(t.file)}>
                  <span className="template-pick-name">{t.name}</span>
                  <span className="template-pick-meta">{t.occasion || 'Gift'}</span>
                  <span className="template-pick-sold">{t.sites > 0 ? `${t.sites} sold` : 'Not sold yet'}</span>
                </button>
              ))}
              {visibleTemplates.length === 0 && <p className="empty-state">No template matches.</p>}
            </div>

            <p className="stat-sub">2. Which order is it for? (optional)</p>
            <div className="order-form-grid">
              <div className="order-field">
                <label>Order</label>
                <select className="item-input" value={pickOrder} onChange={(e) => {
                  const v = e.target.value ? Number(e.target.value) : '';
                  setPickOrder(v);
                  const o = orders.find((x) => x.id === v);
                  if (o) setPickName(o.customer_name);
                }}>
                  <option value="">Not linked</option>
                  {orders.map((o) => <option key={o.id} value={o.id}>{o.order_no ?? `#${o.id}`} · {o.customer_name}</option>)}
                </select>
              </div>
              <div className="order-field">
                <label>Customer name</label>
                <input className="item-input" value={pickName} onChange={(e) => setPickName(e.target.value)} />
              </div>
            </div>

            <div className="order-form-actions">
              <button className="save-btn" onClick={begin} disabled={!pickTemplate}>Start customising</button>
              <button className="add-item-btn" onClick={() => setPicking(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
