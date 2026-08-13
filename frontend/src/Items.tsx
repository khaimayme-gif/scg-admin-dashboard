import { useState, useEffect } from 'react';

const API_BASE = '/api';

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
    fetch(`${API_BASE}/items`, { credentials: 'include' })
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
      await fetch(`${API_BASE}/items/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          id: item.id,
          category: item.category,
          name: item.name,
          menuPrice: item.menu_price,
          originalCost: item.original_cost,
        }),
      });
    } finally {
      setSavingId(null);
    }
  };

  const handleDelete = async (id: number) => {
    await fetch(`${API_BASE}/items/delete/${id}`, { method: 'DELETE', credentials: 'include' });
    loadItems();
  };

  const handleAddItem = async () => {
    if (!newCategory.trim() || !newName.trim() || !newMenuPrice) return;
    await fetch(`${API_BASE}/items/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ category: newCategory.trim(), name: newName.trim(), menuPrice: Number(newMenuPrice) }),
    });
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
          {Object.entries(grouped).map(([category, categoryItems]) => (
            <div className="calc-panel items-category-panel" key={category}>
              <h2 className="panel-label">{category}</h2>
              <table className="items-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Menu price</th>
                    <th>Original cost</th>
                    <th>Profit</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {categoryItems.map((item) => {
                    const profit = item.original_cost !== null ? item.menu_price - item.original_cost : null;
                    return (
                      <tr key={item.id}>
                        <td>{item.name}</td>
                        <td className="items-price-cell">{item.menu_price.toFixed(0)} THB</td>
                        <td>
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
                            />
                          </div>
                        </td>
                        <td className={`items-price-cell ${profit !== null && profit < 0 ? 'profit-negative' : ''}`}>
                          {profit !== null ? `${profit.toFixed(0)} THB` : '—'}
                          {savingId === item.id && ' …'}
                        </td>
                        <td>
                          <button className="item-remove" onClick={() => handleDelete(item.id)} aria-label={`Delete ${item.name}`}>×</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}

          <div className="calc-panel">
            <h2 className="panel-label">Add new item</h2>
            <div className="item-row">
              <input
                type="text"
                placeholder="Category (e.g. Cake Collection)"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                className="item-input"
                style={{ flex: 1 }}
              />
              <input
                type="text"
                placeholder="Item name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="item-input"
                style={{ flex: 1 }}
              />
              <div className="item-input-cost-wrap">
                <span className="currency-prefix">THB</span>
                <input
                  type="number"
                  placeholder="Menu price"
                  value={newMenuPrice}
                  onChange={(e) => setNewMenuPrice(e.target.value)}
                  className="item-input item-input-cost"
                  min="0"
                />
              </div>
              <button className="add-item-btn" onClick={handleAddItem}>+ Add</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}