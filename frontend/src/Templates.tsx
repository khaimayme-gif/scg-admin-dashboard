import { useState, useEffect } from 'react';
import { apiFetch, jsonBody } from './api';

// Template Library: the digital gift templates on the landing page (templates.html).
// Everything here is what visitors see; "Show on the website" off hides a template without deleting it.

interface Template {
  id: number;
  name: string;
  occasion: string | null;
  categories: string[];
  price: number | null;
  description: string | null;
  video_url: string | null;
  published: boolean;
  sort_order: number;
}

interface FormState {
  id: number | null;
  name: string;
  occasion: string;
  categories: string[];
  price: string;
  description: string;
  videoUrl: string;
  published: boolean;
}

// The filter buttons on templates.html. Keep in sync with CATEGORIES in lib/routes/templates.js.
const CATEGORIES: [string, string][] = [
  ['love', 'Love'],
  ['birthday', 'Birthday'],
  ['family', 'Family'],
  ['friendship', 'Friendship'],
  ['celebration', 'Celebration'],
  ['appreciation', 'Appreciation'],
];

// Over this, warn: the templates page plays every preview, so big files make it slow for visitors.
const LARGE_VIDEO_BYTES = 8 * 1024 * 1024;

const emptyForm = (): FormState => ({
  id: null, name: '', occasion: '', categories: [], price: '', description: '', videoUrl: '', published: true,
});

const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);

// PUT the file straight to Supabase Storage (fetch has no upload progress, XHR does).
function uploadWithProgress(url: string, file: File, onProgress: (pct: number) => void) {
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

export default function Templates() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [importing, setImporting] = useState(false);

  const [form, setForm] = useState<FormState>(emptyForm());
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [uploadNote, setUploadNote] = useState('');

  const load = () => {
    setLoading(true);
    apiFetch('/templates')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((rows) => {
        setTemplates(Array.isArray(rows) ? rows : []);
        setLoadError('');
      })
      .catch(() => setLoadError('Could not load the templates.'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const toggleCategory = (cat: string) =>
    setForm((prev) => ({
      ...prev,
      categories: prev.categories.includes(cat) ? prev.categories.filter((c) => c !== cat) : [...prev.categories, cat],
    }));

  const openNew = () => {
    setForm(emptyForm());
    setFormError('');
    setUploadNote('');
    setShowForm(true);
  };

  const startEdit = (t: Template) => {
    setForm({
      id: t.id,
      name: t.name,
      occasion: t.occasion ?? '',
      categories: t.categories ?? [],
      price: t.price === null ? '' : String(t.price),
      description: t.description ?? '',
      videoUrl: t.video_url ?? '',
      published: t.published,
    });
    setFormError('');
    setUploadNote('');
    setShowForm(true);
  };

  const closeForm = () => {
    if (uploadPct !== null) return; // don't lose an upload in progress
    setShowForm(false);
    setForm(emptyForm());
  };

  const handleVideo = async (file: File | undefined) => {
    if (!file) return;
    setFormError('');
    setUploadNote(file.size > LARGE_VIDEO_BYTES
      ? `This video is ${mb(file.size)} MB. Every visitor downloads it, so under about 5 MB keeps the templates page fast.`
      : '');
    setUploadPct(0);
    try {
      const res = await apiFetch('/templates/upload-url', jsonBody({ fileName: file.name, contentType: file.type, size: file.size }));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not start the upload.');
      await uploadWithProgress(data.uploadUrl, file, setUploadPct);
      update('videoUrl', data.publicUrl);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploadPct(null);
    }
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      setFormError('Give the template a name.');
      return;
    }
    if (form.price && !/^\d+$/.test(form.price.trim())) {
      setFormError('Price must be a whole number of baht.');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      const res = await apiFetch('/templates/save', jsonBody({
        id: form.id ?? undefined,
        name: form.name,
        occasion: form.occasion,
        categories: form.categories,
        price: form.price.trim() === '' ? null : Number(form.price),
        description: form.description,
        videoUrl: form.videoUrl,
        published: form.published,
      }));
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Could not save the template.');
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not save the template.');
      setSaving(false);
      return;
    }
    setSaving(false);
    setShowForm(false);
    load();
  };

  const handleDelete = async () => {
    if (form.id === null || !window.confirm(`Delete "${form.name}"? It disappears from the website.`)) return;
    try {
      await apiFetch(`/templates/delete/${form.id}`, { method: 'DELETE' });
    } catch {
      return;
    }
    setShowForm(false);
    load();
  };

  const move = async (index: number, delta: number) => {
    const next = [...templates];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setTemplates(next); // show the new order right away
    try {
      const res = await apiFetch('/templates/reorder', jsonBody({ ids: next.map((t) => t.id) }));
      if (!res.ok) throw new Error();
    } catch {
      load(); // put back what the server has
    }
  };

  const handleImport = async () => {
    setImporting(true);
    try {
      const res = await apiFetch('/templates/import', { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setLoadError(data.error || 'Could not import the templates.');
      }
    } catch {
      setLoadError('Could not import the templates.');
    }
    setImporting(false);
    load();
  };

  return (
    <div className="page">
      <header className="page-header page-header-row">
        <div>
          <h1>Template Library</h1>
          <p className="page-subtitle">
            The digital gift templates on the website&rsquo;s Digital Gift page. Changes show there within a minute.
          </p>
        </div>
        <button className="new-order-btn" onClick={openNew}>New Template</button>
      </header>

      {loadError && <p className="error-text">{loadError}</p>}

      {loading ? (
        <p className="empty-state">Loading…</p>
      ) : templates.length === 0 ? (
        <div className="calc-panel">
          <p className="empty-state">No templates yet.</p>
          <p className="stat-sub" style={{ marginBottom: 14 }}>
            Bring in the 21 templates currently on the website, with their names, prices, descriptions and videos.
            You can edit any of them afterwards.
          </p>
          <button className="save-btn" style={{ width: 'auto' }} onClick={handleImport} disabled={importing}>
            {importing ? 'Importing…' : 'Import templates from the website'}
          </button>
        </div>
      ) : (
        <div className="catalog-grid tpl-admin-grid">
          {templates.map((t, i) => (
            <div key={t.id} className={`item-card tpl-admin-card ${t.published ? '' : 'is-hidden'}`}>
              <button className="tpl-admin-open" onClick={() => startEdit(t)} aria-label={`Edit ${t.name}`}>
                <div className="tpl-admin-video">
                  {t.video_url
                    ? <video src={t.video_url} muted loop playsInline autoPlay preload="metadata" />
                    : <span className="item-card-empty">No video</span>}
                  {!t.published && <span className="item-card-flag">Hidden</span>}
                </div>
                {t.occasion && <span className="item-card-code">{t.occasion.toUpperCase()}</span>}
                <span className="item-card-name">{t.name}</span>
                <span className="item-card-desc">
                  {t.categories.map((c) => CATEGORIES.find(([v]) => v === c)?.[1] ?? c).join(' · ') || 'No category'}
                </span>
                <span className="item-card-price">{t.price === null ? '—' : `${t.price.toLocaleString()} ฿`}</span>
              </button>
              <div className="tpl-admin-order">
                <button className="toggle-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move earlier">↑</button>
                <button className="toggle-btn" onClick={() => move(i, 1)} disabled={i === templates.length - 1} aria-label="Move later">↓</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <div className="modal-header">
              <h2 className="panel-label">{form.id ? 'Edit template' : 'New template'}</h2>
              <button className="item-remove" onClick={closeForm} aria-label="Close">×</button>
            </div>

            <div className="tpl-admin-form">
              <div className="tpl-admin-video tpl-admin-video-lg">
                {form.videoUrl
                  ? <video key={form.videoUrl} src={form.videoUrl} muted loop playsInline autoPlay controls />
                  : <span className="item-card-empty">No video</span>}
              </div>

              <div className="tpl-admin-fields">
                <div className="order-form-grid">
                  <div className="order-field">
                    <label>Name</label>
                    <input type="text" className="item-input" placeholder="e.g. Oh My Love"
                      value={form.name} onChange={(e) => update('name', e.target.value)} />
                  </div>
                  <div className="order-field">
                    <label>Occasion tag</label>
                    <input type="text" className="item-input" placeholder="e.g. Anniversary"
                      value={form.occasion} onChange={(e) => update('occasion', e.target.value)} />
                  </div>
                  <div className="order-field">
                    <label>Price (THB)</label>
                    <input type="number" min="0" step="1" className="item-input" placeholder="290"
                      value={form.price} onChange={(e) => update('price', e.target.value)} />
                  </div>
                </div>

                <div className="order-field" style={{ marginBottom: 16 }}>
                  <label>Filters it appears under</label>
                  <div className="toggle-group tpl-admin-cats">
                    {CATEGORIES.map(([value, label]) => (
                      <button key={value} type="button"
                        className={`toggle-btn ${form.categories.includes(value) ? 'is-active' : ''}`}
                        onClick={() => toggleCategory(value)}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="order-field" style={{ marginBottom: 16 }}>
                  <label>Description</label>
                  <textarea className="item-input order-item-details" rows={3}
                    placeholder="What the gift site has, in a sentence or two"
                    value={form.description} onChange={(e) => update('description', e.target.value)} />
                </div>

                <div className="order-field" style={{ marginBottom: 16 }}>
                  <label>Preview video</label>
                  <div className="photo-actions">
                    <label className="add-item-btn tpl-admin-upload">
                      {uploadPct !== null ? `Uploading… ${uploadPct}%` : form.videoUrl ? 'Replace video' : 'Upload video'}
                      <input type="file" accept="video/mp4,video/webm,video/quicktime" hidden
                        disabled={uploadPct !== null}
                        onChange={(e) => { handleVideo(e.target.files?.[0]); e.target.value = ''; }} />
                    </label>
                    {uploadNote && <p className="stat-sub">{uploadNote}</p>}
                    <input type="url" className="item-input" placeholder="…or paste a video link (https://…)"
                      value={form.videoUrl} onChange={(e) => update('videoUrl', e.target.value)} />
                  </div>
                </div>

                <label className="tpl-admin-check">
                  <input type="checkbox" checked={form.published} onChange={(e) => update('published', e.target.checked)} />
                  Show on the website
                </label>
              </div>
            </div>

            {formError && <p className="error-text">{formError}</p>}

            <div className="order-form-actions">
              <button className="save-btn" onClick={handleSubmit} disabled={saving || uploadPct !== null}>
                {saving ? 'Saving…' : form.id ? 'Save changes' : 'Add template'}
              </button>
              <button className="add-item-btn" onClick={closeForm} disabled={saving || uploadPct !== null}>Cancel</button>
              {form.id !== null && (
                <button className="order-edit-btn danger-link" onClick={handleDelete} disabled={saving || uploadPct !== null}>
                  Delete
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
