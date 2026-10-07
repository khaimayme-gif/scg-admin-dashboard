import { useState, useEffect, useRef } from 'react';
import { apiFetch, jsonBody } from './api';
import { readItemsWorkbook } from './itemImport';
import type { ImportRow } from './itemImport';

interface Item {
  id: number;
  category: string;
  name: string;
  menu_price: number;
  original_cost: number | null;
  item_code: string | null;
  description: string | null;
  item_group: string | null;
  published: boolean;
  has_photo: boolean;
  photo_name: string | null;
  photo_version: number;
}

interface ItemType {
  id: number;
  name: string;
  code: string;
  next_code: string;
  item_count: number;
}

interface FormState {
  id?: number;
  itemCode: string;
  category: string;
  name: string;
  description: string;
  itemGroup: string;
  menuPrice: string;
  originalCost: string;
  published: boolean;
  // undefined = keep what is saved, null = remove, string = new photo (data URL)
  photo: string | null | undefined;
  existingPhotoUrl: string | null;
}

const emptyForm = (): FormState => ({
  itemCode: '', category: '', name: '', description: '', itemGroup: '', menuPrice: '', originalCost: '',
  published: true, photo: undefined, existingPhotoUrl: null,
});

const photoUrl = (item: Item) => `/api/items/photo/${item.id}?v=${item.photo_version}`;
const fmt = (n: number) => Math.round(n).toLocaleString();

// Shrinks a chosen image to at most 900px on its longest side and re-encodes it as JPEG, so a
// 5 MB phone photo becomes roughly 100 KB before it is uploaded.
function compressImage(file: File, maxSide = 900, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error('Canvas not available'));
        return;
      }
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that image'));
    };
    img.src = url;
  });
}

function TypesModal({ types, onClose, onChanged }: { types: ItemType[]; onClose: () => void; onChanged: () => void }) {
  const [editing, setEditing] = useState<{ id?: number; name: string; code: string } | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const suggestCode = (name: string) => name.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase();

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    setError('');
    try {
      const res = await apiFetch('/item-types/save', jsonBody(editing));
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Could not save the type.');
        return;
      }
      setEditing(null);
      onChanged();
    } catch {
      // a 401 has already sent us back to login
    } finally {
      setSaving(false);
    }
  };

  const remove = async (t: ItemType) => {
    if (!window.confirm(`Delete the type "${t.name}"?`)) return;
    setError('');
    try {
      const res = await apiFetch(`/item-types/delete/${t.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Could not delete the type.');
        return;
      }
      onChanged();
    } catch {
      // a 401 has already sent us back to login
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-card types-card">
        <div className="modal-header">
          <h2 className="panel-label">Item types</h2>
          <button className="item-remove" onClick={onClose} aria-label="Close">×</button>
        </div>
        <p className="stat-sub">
          A type sets where an item goes on the website menu, and the first letters of its Item ID
          (code CK gives CK01, CK02, ...). Changing a code doesn’t change IDs already given out.
        </p>

        <ul className="types-list">
          {types.map((t) => (
            <li className="types-row" key={t.id}>
              <span className="types-code">{t.code}</span>
              <span className="types-name">{t.name}</span>
              <span className="types-count">{t.item_count} {t.item_count === 1 ? 'item' : 'items'}</span>
              <button className="order-edit-btn" onClick={() => setEditing({ id: t.id, name: t.name, code: t.code })}>Edit</button>
              <button className="item-remove" onClick={() => remove(t)} aria-label={`Delete ${t.name}`}>×</button>
            </li>
          ))}
          {types.length === 0 && <li className="empty-state">No types yet.</li>}
        </ul>

        {editing ? (
          <div className="types-edit">
            <div className="order-form-grid">
              <div className="order-field">
                <label>Type name</label>
                <input className="item-input" placeholder="e.g. Cake" value={editing.name} autoFocus
                  onChange={(e) => {
                    const name = e.target.value;
                    setEditing((prev) => prev && {
                      ...prev,
                      name,
                      code: prev.id || prev.code !== suggestCode(prev.name) ? prev.code : suggestCode(name),
                    });
                  }} />
              </div>
              <div className="order-field">
                <label>ID code (1–4 letters)</label>
                <input className="item-input" placeholder="e.g. CK" maxLength={4} value={editing.code}
                  onChange={(e) => setEditing((prev) => prev && { ...prev, code: e.target.value.toUpperCase() })} />
              </div>
            </div>
            <div className="order-form-actions">
              <button className="save-btn" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save type'}</button>
              <button className="add-item-btn" onClick={() => { setEditing(null); setError(''); }} disabled={saving}>Cancel</button>
            </div>
          </div>
        ) : (
          <button className="add-item-btn" onClick={() => setEditing({ name: '', code: '' })}>Add type</button>
        )}
        {error && <p className="error-text">{error}</p>}
      </div>
    </div>
  );
}

function ImportModal({ types, itemCount, onClose, onDone }: {
  types: ItemType[];
  itemCount: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [readError, setReadError] = useState('');
  const [importing, setImporting] = useState(false);
  const [serverError, setServerError] = useState('');
  const [serverRows, setServerRows] = useState<{ row: number; error: string }[]>([]);
  const [confirmMore, setConfirmMore] = useState(false);
  const [result, setResult] = useState<{ created: number; first: string; last: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const typeByName = new Map(types.map((t) => [t.name.trim().toLowerCase(), t]));

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setReadError('');
    setServerError('');
    setServerRows([]);
    setRows(null);
    setFileName(file.name);
    try {
      setRows(await readItemsWorkbook(file));
    } catch (err) {
      setReadError(err instanceof Error ? err.message : 'Could not read that file.');
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  // The same checks the server makes, so problems show before anything is sent.
  const problems = (rows ?? []).flatMap((r) => {
    if (!typeByName.has(r.type.trim().toLowerCase())) return [{ line: r.line, error: `Unknown item type "${r.type}"` }];
    if (!r.name) return [{ line: r.line, error: 'Item name is missing' }];
    if (r.price === null || r.price < 0) return [{ line: r.line, error: 'Selling price is missing or not a number' }];
    return [];
  });

  // Which Item IDs each type will get, in row order.
  const summary = types
    .map((t) => {
      const count = (rows ?? []).filter((r) => r.type.trim().toLowerCase() === t.name.trim().toLowerCase()).length;
      const start = Number(t.next_code.replace(/\D/g, ''));
      const id = (n: number) => `${t.code}${String(n).padStart(2, '0')}`;
      return { name: t.name, count, range: count ? (count === 1 ? id(start) : `${id(start)} to ${id(start + count - 1)}`) : '' };
    })
    .filter((s) => s.count > 0);
  const hidden = (rows ?? []).filter((r) => !r.show).length;

  const run = async () => {
    if (!rows || problems.length > 0) return;
    setImporting(true);
    setServerError('');
    setServerRows([]);
    try {
      const res = await apiFetch('/items/import', jsonBody({
        rows: rows.map((r) => ({
          type: r.type, group: r.group, name: r.name, detail: r.detail,
          price: r.price, cost: r.cost, photoName: r.photoName, show: r.show,
        })),
      }));
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setServerError(data.error || 'Could not import the items.');
        setServerRows(Array.isArray(data.errors) ? data.errors : []);
        return;
      }
      setResult(data);
      onDone();
    } catch {
      // a 401 has already sent us back to login
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-card types-card">
        <div className="modal-header">
          <h2 className="panel-label">Import items from Excel</h2>
          <button className="item-remove" onClick={onClose} aria-label="Close">×</button>
        </div>

        {result ? (
          <>
            <p className="order-profit">Imported {result.created} items ({result.first} to {result.last}).</p>
            <p className="stat-sub">Photos can be added later: open an item and use “Upload photo”.</p>
            <div className="order-form-actions">
              <button className="save-btn" onClick={onClose}>Done</button>
            </div>
          </>
        ) : (
          <>
            <p className="stat-sub">
              Choose the filled-in import template (.xlsx). You will see what will be created before anything is saved.
              Item IDs are given automatically, per type, in row order.
            </p>
            <input ref={fileRef} type="file" accept=".xlsx" hidden onChange={(e) => onFile(e.target.files?.[0])} />
            <button className="add-item-btn" onClick={() => fileRef.current?.click()}>{fileName ? 'Choose another file' : 'Choose Excel file'}</button>
            {fileName && <span className="stat-sub"> {fileName}</span>}
            {readError && <p className="error-text">{readError}</p>}

            {rows && (
              <>
                <h3 className="order-subheading">{rows.length} items found</h3>
                <ul className="types-list">
                  {summary.map((s) => (
                    <li className="types-row" key={s.name}>
                      <span className="types-name">{s.name}</span>
                      <span className="types-count">{s.count} {s.count === 1 ? 'item' : 'items'}</span>
                      <span className="types-code">{s.range}</span>
                    </li>
                  ))}
                </ul>
                {hidden > 0 && <p className="stat-sub">{hidden} {hidden === 1 ? 'item is' : 'items are'} marked “No” for the website menu.</p>}

                {problems.length > 0 && (
                  <div className="warn-text">
                    Fix these rows in Excel and choose the file again:
                    <ul className="import-problems">
                      {problems.slice(0, 8).map((p) => <li key={p.line}>Row {p.line}: {p.error}</li>)}
                    </ul>
                    {problems.length > 8 && <span>and {problems.length - 8} more.</span>}
                  </div>
                )}

                {itemCount > 0 && problems.length === 0 && (
                  <label className="frame-toggle">
                    <input type="checkbox" checked={confirmMore} onChange={(e) => setConfirmMore(e.target.checked)} />
                    You already have {itemCount} items. Importing adds these as new items (nothing is replaced).
                  </label>
                )}

                {serverError && <p className="error-text">{serverError}</p>}
                {serverRows.length > 0 && (
                  <ul className="import-problems">
                    {serverRows.slice(0, 8).map((p) => <li key={p.row}>Row {p.row}: {p.error}</li>)}
                  </ul>
                )}

                <div className="order-form-actions">
                  <button
                    className="save-btn"
                    onClick={run}
                    disabled={importing || problems.length > 0 || rows.length === 0 || (itemCount > 0 && !confirmMore)}
                  >
                    {importing ? 'Importing…' : `Import ${rows.length} items`}
                  </button>
                  <button className="add-item-btn" onClick={onClose} disabled={importing}>Cancel</button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function Items() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [types, setTypes] = useState<ItemType[]>([]);
  const [showTypes, setShowTypes] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const loadItems = () =>
    apiFetch('/items')
      .then((res) => res.json())
      .then((data) => setItems(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoading(false));

  const loadTypes = () =>
    apiFetch('/item-types')
      .then((res) => res.json())
      .then((data) => setTypes(Array.isArray(data) ? data : []))
      .catch(() => {});

  useEffect(() => {
    loadItems();
    loadTypes();
  }, []);

  // Picking a type fills in the next free Item ID for it (CK01, CK02, ...). Still editable.
  const chooseType = (name: string) => {
    const type = types.find((t) => t.name === name);
    setForm((prev) => (prev ? { ...prev, category: name, itemCode: type ? type.next_code : prev.itemCode } : prev));
  };

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));

  const openNew = () => {
    setForm(emptyForm());
    setFormError('');
  };

  const openEdit = (item: Item) => {
    setForm({
      id: item.id,
      itemCode: item.item_code ?? '',
      category: item.category,
      name: item.name,
      description: item.description ?? '',
      itemGroup: item.item_group ?? '',
      menuPrice: String(item.menu_price),
      originalCost: item.original_cost === null ? '' : String(item.original_cost),
      published: item.published,
      photo: undefined,
      existingPhotoUrl: item.has_photo ? photoUrl(item) : null,
    });
    setFormError('');
  };

  const closeForm = () => setForm(null);

  const handlePhoto = async (file: File | undefined) => {
    if (!file) return;
    try {
      update('photo', await compressImage(file));
      setFormError('');
    } catch {
      setFormError('Could not read that image. Try a JPG or PNG.');
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleSubmit = async () => {
    if (!form) return;
    if (!form.category.trim() || !form.name.trim() || form.menuPrice === '') {
      setFormError('Item type, name and selling price are required.');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      const res = await apiFetch('/items/save', jsonBody({
        id: form.id,
        itemCode: form.itemCode,
        category: form.category.trim(),
        name: form.name.trim(),
        description: form.description,
        itemGroup: form.itemGroup,
        menuPrice: Number(form.menuPrice),
        originalCost: form.originalCost === '' ? null : Number(form.originalCost),
        published: form.published,
        photo: form.photo,
      }));
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setFormError(data.error || 'Could not save the item.');
        return;
      }
      setForm(null);
      await Promise.all([loadItems(), loadTypes()]);
    } catch {
      // a 401 has already sent us back to login
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!form?.id) return;
    if (!window.confirm(`Delete "${form.name}"? It will also disappear from the website menu.`)) return;
    try {
      await apiFetch(`/items/delete/${form.id}`, { method: 'DELETE' });
    } catch {
      return;
    }
    setForm(null);
    loadItems();
    loadTypes();
  };

  const grouped = items.reduce<Record<string, Item[]>>((acc, item) => {
    (acc[item.category] ||= []).push(item);
    return acc;
  }, {});
  // Follow the order the types were created in; anything not in the list (older items) goes last.
  const typeOrder = (name: string) => {
    const i = types.findIndex((t) => t.name === name);
    return i === -1 ? types.length : i;
  };
  const categories = Object.keys(grouped).sort((a, b) => typeOrder(a) - typeOrder(b));

  const previewSrc = form ? (form.photo === undefined ? form.existingPhotoUrl : form.photo) : null;
  const price = Number(form?.menuPrice) || 0;
  const cost = form?.originalCost === '' ? null : Number(form?.originalCost);
  const profit = cost === null || cost === undefined || Number.isNaN(cost) ? null : price - cost;

  return (
    <div className="page">
      <header className="page-header page-header-row">
        <div>
          <h1>Items</h1>
          <p className="page-subtitle">
            Your catalog. Published items show up on the So Chic Gifts website menu, with the photo, name and selling price.
          </p>
        </div>
        <div className="header-actions">
          <button className="header-secondary-btn" onClick={() => setShowImport(true)}>Import</button>
          <button className="header-secondary-btn" onClick={() => setShowTypes(true)}>Item Types</button>
          <button className="new-order-btn" onClick={openNew}>New Item</button>
        </div>
      </header>

      {loading ? (
        <p className="empty-state">Loading…</p>
      ) : (
        <>
          {items.length === 0 && <p className="empty-state">No items yet. Tap “New Item” to add your first design.</p>}

          {categories.map((category) => (
            <section className="catalog-section" key={category}>
              <div className="catalog-head">
                <h2 className="catalog-title">{category}</h2>
                <span className="items-count">
                  {grouped[category].length} {grouped[category].length === 1 ? 'item' : 'items'}
                </span>
              </div>
              <div className="catalog-grid">
                {grouped[category].map((item) => {
                  const itemProfit = item.original_cost !== null ? item.menu_price - item.original_cost : null;
                  return (
                    <button className="item-card" key={item.id} onClick={() => openEdit(item)}>
                      <div className="item-card-photo">
                        {item.has_photo ? (
                          <img src={photoUrl(item)} alt={item.name} loading="lazy" />
                        ) : (
                          <span className="item-card-empty">No photo</span>
                        )}
                        {!item.published && <span className="item-card-flag">Hidden</span>}
                      </div>
                      <span className="item-card-code">{item.item_code ?? 'No ID'}{item.item_group ? ` · ${item.item_group}` : ''}</span>
                      <span className="item-card-name">{item.name}</span>
                      <span className="item-card-desc">{item.description ?? ''}</span>
                      <span className="item-card-price">฿{fmt(item.menu_price)}</span>
                      <span className={`item-card-cost ${itemProfit !== null && itemProfit < 0 ? 'profit-negative' : ''}`}>
                        {item.original_cost === null
                          ? 'Cost not set'
                          : `Cost ฿${fmt(item.original_cost)} · Profit ฿${fmt(itemProfit ?? 0)}`}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </>
      )}

      {showImport && (
        <ImportModal
          types={types}
          itemCount={items.length}
          onClose={() => setShowImport(false)}
          onDone={() => { loadItems(); loadTypes(); }}
        />
      )}

      {showTypes && (
        <TypesModal
          types={types}
          onClose={() => setShowTypes(false)}
          onChanged={() => { loadTypes(); loadItems(); }}
        />
      )}

      {form && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <div className="modal-header">
              <h2 className="panel-label">{form.id ? 'Edit item' : 'New item'}</h2>
              <button className="item-remove" onClick={closeForm} aria-label="Close">×</button>
            </div>

            <div className="order-field type-field">
              <label>Item type</label>
              <select className="item-input" value={form.category} onChange={(e) => chooseType(e.target.value)}>
                <option value="" disabled>Choose an item type…</option>
                {types.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
                {form.category && !types.some((t) => t.name === form.category) && (
                  <option value={form.category}>{form.category}</option>
                )}
              </select>
              {types.length === 0 && <p className="stat-sub">No item types yet. Add some with “Item Types” first.</p>}
            </div>

            {form.category && (
            <div className="photo-field">
              <div className="photo-preview">
                {previewSrc ? <img src={previewSrc} alt="Item preview" /> : <span>No photo yet</span>}
              </div>
              <div className="photo-actions">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => handlePhoto(e.target.files?.[0])}
                />
                <button className="add-item-btn" type="button" onClick={() => fileRef.current?.click()}>
                  {previewSrc ? 'Change photo' : 'Upload photo'}
                </button>
                {previewSrc && (
                  <button className="order-edit-btn" type="button" onClick={() => update('photo', null)} hidden={form.photo === null}>
                    Remove
                  </button>
                )}
                <p className="stat-sub">Square photos look best. Large images are shrunk automatically.</p>
              </div>
            </div>
            )}

            {form.category && (
            <div className="order-form-grid">
              <div className="order-field">
                <label>Item ID (auto, you can change it)</label>
                <input className="item-input" placeholder="e.g. CK01" value={form.itemCode}
                  onChange={(e) => update('itemCode', e.target.value)} />
              </div>
              <div className="order-field">
                <label>Group (optional)</label>
                <input className="item-input" placeholder="e.g. Birthday Cake, Real Flowers" value={form.itemGroup}
                  onChange={(e) => update('itemGroup', e.target.value)} />
              </div>
              <div className="order-field">
                <label>Item name</label>
                <input className="item-input" placeholder="e.g. Design 1" value={form.name}
                  onChange={(e) => update('name', e.target.value)} />
              </div>
              <div className="order-field">
                <label>Detail (optional)</label>
                <input className="item-input" placeholder="e.g. 4 inches" value={form.description}
                  onChange={(e) => update('description', e.target.value)} />
              </div>
              <div className="order-field">
                <label>Selling price (THB)</label>
                <input type="number" min="0" className="item-input" placeholder="0" value={form.menuPrice}
                  onChange={(e) => update('menuPrice', e.target.value)} />
              </div>
              <div className="order-field">
                <label>Cost (THB, only you see this)</label>
                <input type="number" min="0" className="item-input" placeholder="0" value={form.originalCost}
                  onChange={(e) => update('originalCost', e.target.value)} />
              </div>
            </div>
            )}

            {profit !== null && (
              <p className={`order-profit ${profit < 0 ? 'profit-negative' : ''}`}>
                Profit {fmt(profit)} THB{price > 0 ? ` (${Math.round((profit / price) * 100)}%)` : ''}
              </p>
            )}

            <label className="frame-toggle">
              <input type="checkbox" checked={form.published} onChange={(e) => update('published', e.target.checked)} />
              Show on the website menu
            </label>

            {formError && <p className="error-text">{formError}</p>}

            <div className="order-form-actions">
              <button className="save-btn" onClick={handleSubmit} disabled={saving}>
                {saving ? 'Saving…' : form.id ? 'Save changes' : 'Add item'}
              </button>
              <button className="add-item-btn" onClick={closeForm} disabled={saving}>Cancel</button>
              {form.id && (
                <button className="order-edit-btn danger-link" onClick={handleDelete} disabled={saving}>Delete item</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
