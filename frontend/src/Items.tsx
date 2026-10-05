import { useState, useEffect } from 'react';
import { apiFetch, jsonBody } from './api';

interface Item {
  id: number;
  category: string;
  name: string;
  menu_price: number;
  original_cost: number | null;
}

export default function Items() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | null>(null);

  const [newCategory, setNewCategory] = useState('');
  const [newName, setNewName] = useState('');
  const [newMenuPrice, setNewMenuPrice] = useState('');

  const loadItems = () => {
    apiFetch('/items')
      .then((res) => res.json())
      .then((data) => {
        setItems(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    loadItems();
  }, []);

  const handleCostChange = (id: number, value: string) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, original_cost: value === '' ? null : Number(value) } : item)));
  };

  const handleSaveCost = async (item: Item) => {
    setSavingId(item.id);
    try {
      await apiFetch('/items/save', jsonBody({
        id: item.id,
        category: item.category,
        name: item.name,
        menuPrice: item.menu_price,
        originalCost: item.original_cost,
      }));
    } catch {
      // a 401 has already sent us back to login; nothing useful to show on this row
    } finally {
      setSavingId(null);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await apiFetch(`/items/delete/${id}`, { method: 'DELETE' });
    } catch {
      return;
    }
    loadItems();
  };

  const handleAddItem = async () => {
    if (!newCategory.trim() || !newName.trim() || !newMenuPrice) return;
    try {
      await apiFetch('/items/save', jsonBody({
        category: newCategory.trim(),
        name: newName.trim(),
        menuPrice: Number(newMenuPrice),
      }));
    } catch {
      return;
    }
    setNewCategory('');
    setNewName('');
    setNewMenuPrice('');
    loadItems();
  };

  const grouped = items.reduce<Record<string, Item[]>>((acc, item) => {
    (acc[item.category] ||= []).push(item);
    return acc;
  }, {});

  return (
    <div className="page">
      <header className="page-header">
        <h1>Items</h1>
        <p className="page-subtitle">Your menu prices next to your real costs, so you always know your margin.</p>
      </header>

      {loading ? (
        <p className="empty-state">Loading…</p>
      ) : (
        <>
          {items.length === 0 && (
            <p className="empty-state">No items yet. Add your first one below.</p>
          )}
          {Object.entries(grouped).map(([category, categoryItems]) => (
            <section className="calc-panel items-category-panel" key={category}>
              <div className="items-category-head">
                <h2 className="panel-label">{category}</h2>
                <span className="items-count">
                  {categoryItems.length} {categoryItems.length === 1 ? 'item' : 'items'}
                </span>
              </div>
              <div className="items-cols" aria-hidden="true">
                <span>Item</span>
                <span>Menu price</span>
                <span>Original cost</span>
                <span>Profit</span>
                <span />
              </div>
              <ul className="items-list">
                {categoryItems.map((item) => {
                  const profit = item.original_cost !== null ? item.menu_price - item.original_cost : null;
                  const margin = profit !== null && item.menu_price > 0 ? Math.round((profit / item.menu_price) * 100) : null;
                  return (
                    <li className="items-row" key={item.id}>
                      <span className="items-name">{item.name}</span>
                      <span className="items-price">{item.menu_price.toFixed(0)} THB</span>
                      <div className="item-input-cost-wrap">
                        <span className="currency-prefix">THB</span>
                        <input
                          type="number"
                          placeholder="—"
                          value={item.original_cost ?? ''}
                          onChange={(e) => handleCostChange(item.id, e.target.value)}
                          onBlur={() => handleSaveCost(item)}
                          className="item-input item-input-cost"
                          min="0"
                          aria-label={`Original cost of ${item.name}`}
                        />
                      </div>
                      <span className={`items-profit ${profit !== null && profit < 0 ? 'profit-negative' : ''}`}>
                        {profit !== null ? `${profit.toFixed(0)} THB` : '—'}
                        {margin !== null && (
                          <span className={`margin-pill ${margin < 0 ? 'is-negative' : ''}`}>{margin}%</span>
                        )}
                        {savingId === item.id && <span className="items-saving">saving…</span>}
                      </span>
                      <button className="item-remove" onClick={() => handleDelete(item.id)} aria-label={`Delete ${item.name}`}>×</button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

          <section className="calc-panel">
            <h2 className="panel-label">Add new item</h2>
            <div className="items-add-grid">
              <div className="order-field">
                <label htmlFor="new-category">Category</label>
                <input
                  id="new-category"
                  type="text"
                  placeholder="e.g. Cake Collection"
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  className="item-input"
                  list="item-categories"
                />
                <datalist id="item-categories">
                  {Object.keys(grouped).map((c) => <option key={c} value={c} />)}
                </datalist>
              </div>
              <div className="order-field">
                <label htmlFor="new-name">Item name</label>
                <input
                  id="new-name"
                  type="text"
                  placeholder="Item name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="item-input"
                />
              </div>
              <div className="order-field">
                <label htmlFor="new-price">Menu price</label>
                <div className="item-input-cost-wrap">
                  <span className="currency-prefix">THB</span>
                  <input
                    id="new-price"
                    type="number"
                    placeholder="0"
                    value={newMenuPrice}
                    onChange={(e) => setNewMenuPrice(e.target.value)}
                    className="item-input item-input-cost"
                    min="0"
                  />
                </div>
              </div>
              <button className="add-item-btn" onClick={handleAddItem}>+ Add item</button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}