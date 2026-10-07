import { useState, useEffect, Fragment } from 'react';
import { apiFetch, jsonBody } from './api';

interface Expense {
  id: number;
  name: string;
  expense_date: string; // YYYY-MM-DD
  cost: number;
  unit: string | null;
  currency: string;
  details: string | null;
  recurrence: 'one_time' | 'monthly' | 'yearly';
}

interface Stats {
  oneTimeThisMonthThb: number;
  monthlyRunRateThb: number;
  unconverted: number;
}

interface FormState {
  id: number | null;
  name: string;
  expenseDate: string;
  cost: string;
  unit: string;
  currency: string;
  details: string;
  recurrence: 'one_time' | 'monthly' | 'yearly';
}

const RECURRENCE_LABELS: Record<Expense['recurrence'], string> = {
  one_time: 'One-time',
  monthly: 'Monthly',
  yearly: 'Yearly',
};

const CURRENCIES = ['THB', 'JPY', 'MMK'];

const fmt = (n: number) => Math.round(n).toLocaleString();

// en-CA formats as YYYY-MM-DD in the local timezone, which avoids the off-by-one-day
// that toISOString() causes early in the morning in Thailand (UTC+7).
const todayLocal = () => new Date().toLocaleDateString('en-CA');

const emptyForm = (): FormState => ({
  id: null,
  name: '',
  expenseDate: todayLocal(),
  cost: '',
  unit: '',
  currency: 'THB',
  details: '',
  recurrence: 'one_time',
});

export default function ExpenseTracker() {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const toggleExpanded = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  const [form, setForm] = useState<FormState>(emptyForm());
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const loadAll = () => {
    setLoading(true);
    Promise.all([
      apiFetch('/expenses').then((res) => res.json()),
      apiFetch('/expenses/stats').then((res) => res.json()),
    ])
      .then(([expenseRows, statRow]) => {
        setExpenses(expenseRows);
        setStats(statRow);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    loadAll();
  }, []);

  const openNew = () => {
    setFormError('');
    setForm(emptyForm());
    setShowForm(true);
  };

  const startEdit = (expense: Expense) => {
    setFormError('');
    setForm({
      id: expense.id,
      name: expense.name,
      expenseDate: expense.expense_date,
      cost: String(expense.cost ?? 0),
      unit: expense.unit ?? '',
      currency: expense.currency,
      details: expense.details ?? '',
      recurrence: expense.recurrence,
    });
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setForm(emptyForm());
    setFormError('');
  };

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      setFormError('Give the expense a name.');
      return;
    }
    if (!form.cost || Number.isNaN(Number(form.cost))) {
      setFormError('Enter a cost.');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      await apiFetch('/expenses/save', jsonBody({
        id: form.id ?? undefined,
        name: form.name.trim(),
        expenseDate: form.expenseDate,
        cost: Number(form.cost),
        unit: form.unit.trim(),
        currency: form.currency,
        details: form.details.trim(),
        recurrence: form.recurrence,
      }));
    } catch {
      setFormError('Could not save the expense.');
      setSaving(false);
      return;
    }
    setSaving(false);
    closeForm();
    loadAll();
  };

  const handleDelete = async (expense: Expense) => {
    if (!window.confirm(`Delete "${expense.name}"?`)) return;
    try {
      await apiFetch(`/expenses/delete/${expense.id}`, { method: 'DELETE' });
    } catch {
      return;
    }
    if (form.id === expense.id) closeForm();
    loadAll();
  };

  return (
    <div className="page">
      <header className="page-header page-header-row">
        <div>
          <h1>Expense Tracker</h1>
          <p className="page-subtitle">
            What goes into running So Chic Gifts — domains, extra bouquets, giftboxes, and anything else you put money into.
          </p>
        </div>
        <button className="new-order-btn" onClick={openNew}>New Expense</button>
      </header>

      {loading ? (
        <p className="empty-state">Loading…</p>
      ) : (
        <>
          {stats && (
            <>
              <div className="stat-grid">
                <div className="stat-card">
                  <span className="stat-sub">One-time expenses this month</span>
                  <strong>{fmt(stats.oneTimeThisMonthThb)} THB</strong>
                </div>
                <div className="stat-card">
                  <span className="stat-sub">Recurring, per month (run rate)</span>
                  <strong>{fmt(stats.monthlyRunRateThb)} THB</strong>
                </div>
              </div>
              {stats.unconverted > 0 && (
                <p className="error-text">
                  {stats.unconverted} expense(s) are in JPY or MMK and left out of the totals above.
                </p>
              )}
            </>
          )}

          {showForm && (
            <div className="modal-backdrop">
              <div className="modal-card">
                <div className="modal-header">
                  <h2 className="panel-label">{form.id ? 'Edit expense' : 'New expense'}</h2>
                  <button className="item-remove" onClick={closeForm} aria-label="Close">×</button>
                </div>

                <div className="order-form-grid">
                  <div className="order-field">
                    <label>Name</label>
                    <input
                      type="text"
                      className="item-input"
                      placeholder="e.g. Domain renewal, Extra bouquets"
                      value={form.name}
                      onChange={(e) => update('name', e.target.value)}
                    />
                  </div>
                  <div className="order-field">
                    <label>Date</label>
                    <input
                      type="date"
                      className="item-input"
                      value={form.expenseDate}
                      onChange={(e) => update('expenseDate', e.target.value)}
                    />
                  </div>
                  <div className="order-field">
                    <label>Cost</label>
                    <div className="item-input-cost-wrap">
                      <select
                        className="item-input"
                        style={{ width: 90, flex: 'none' }}
                        value={form.currency}
                        onChange={(e) => update('currency', e.target.value)}
                        aria-label="Currency"
                      >
                        {CURRENCIES.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min="0"
                        className="item-input item-input-cost"
                        placeholder="0"
                        value={form.cost}
                        onChange={(e) => update('cost', e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="order-field">
                    <label>Unit</label>
                    <input
                      type="text"
                      className="item-input"
                      placeholder="e.g. per year, 6 bouquets, per box"
                      value={form.unit}
                      onChange={(e) => update('unit', e.target.value)}
                    />
                  </div>
                  <div className="order-field">
                    <label>Payment</label>
                    <select
                      className="item-input"
                      value={form.recurrence}
                      onChange={(e) => update('recurrence', e.target.value as FormState['recurrence'])}
                    >
                      {Object.entries(RECURRENCE_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="order-field" style={{ marginBottom: 16 }}>
                  <label>Details</label>
                  <textarea
                    className="item-input order-item-details"
                    rows={3}
                    placeholder="Any notes — what it's for, where you bought it, renewal terms..."
                    value={form.details}
                    onChange={(e) => update('details', e.target.value)}
                  />
                </div>

                {formError && <p className="error-text">{formError}</p>}

                <div className="order-form-actions">
                  <button className="save-btn" onClick={handleSubmit} disabled={saving}>
                    {saving ? 'Saving…' : form.id ? 'Save changes' : 'Add expense'}
                  </button>
                  <button className="add-item-btn" onClick={closeForm} disabled={saving}>
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="calc-panel">
            <h2 className="panel-label">All expenses</h2>
            {expenses.length === 0 ? (
              <p className="empty-state">No expenses recorded yet.</p>
            ) : (
              <div className="orders-table-wrap">
                <table className="items-table orders-compact expenses-compact">
                  <thead>
                    <tr>
                      <th>Expense</th>
                      <th>Payment</th>
                      <th className="num-col">Cost</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {expenses.map((exp) => {
                      const isOpen = expanded.has(exp.id);
                      return (
                        <Fragment key={exp.id}>
                          <tr className={isOpen ? 'is-open' : ''}>
                            <td>
                              <span className="cell-main">{exp.name}</span>
                              <span className="cell-sub">{exp.expense_date}</span>
                            </td>
                            <td>
                              <span className={`status-pill ${exp.recurrence !== 'one_time' ? 'status-in_progress' : ''}`}>
                                {RECURRENCE_LABELS[exp.recurrence]}
                              </span>
                            </td>
                            <td className="items-price-cell num-col">{fmt(exp.cost)} {exp.currency}</td>
                            <td className="row-action-cell">
                              <button
                                className={`details-btn ${isOpen ? 'is-open' : ''}`}
                                onClick={() => toggleExpanded(exp.id)}
                                aria-expanded={isOpen}
                              >
                                Details
                                <span className="details-caret" aria-hidden="true">▾</span>
                              </button>
                            </td>
                          </tr>
                          {isOpen && (
                            <tr className="detail-row">
                              <td colSpan={4}>
                                <div className="order-detail">
                                  <dl className="detail-grid">
                                    <div><dt>Date</dt><dd>{exp.expense_date}</dd></div>
                                    <div><dt>Unit</dt><dd>{exp.unit || '—'}</dd></div>
                                    <div className="detail-wide"><dt>Details</dt><dd>{exp.details || '—'}</dd></div>
                                  </dl>
                                  <div className="detail-actions">
                                    <button className="save-btn" onClick={() => startEdit(exp)}>Edit expense</button>
                                    <button className="order-edit-btn danger-link" onClick={() => handleDelete(exp)}>Delete</button>
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
        </>
      )}
    </div>
  );
}
