import { useState, useEffect } from 'react';
import { apiFetch, jsonBody } from './api';
import { ROLES, ROLE_LABELS } from './role';
import type { Role } from './role';

interface User {
  id: number;
  username: string;
  role: Role;
  created_at: string;
  is_me: boolean;
}

interface FormState {
  id?: number;
  username: string;
  role: Role;
  password: string;
  isMe: boolean;
}

const emptyForm = (): FormState => ({ username: '', role: 'thai', password: '', isMe: false });

const ROLE_HINTS: Record<Role, string> = {
  superadmin: 'Everything, all countries, plus Settings and users.',
  thai: 'Thailand orders, quotations, board, items and QR codes only.',
  japan: 'Japan orders, quotations, board, items and QR codes only.',
};

export default function UsersSection() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [pageError, setPageError] = useState('');

  const load = () =>
    apiFetch('/users')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setUsers(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  const openNew = () => {
    setForm(emptyForm());
    setError('');
  };

  const openEdit = (u: User) => {
    setForm({ id: u.id, username: u.username, role: u.role, password: '', isMe: u.is_me });
    setError('');
  };

  const save = async () => {
    if (!form) return;
    setSaving(true);
    setError('');
    try {
      const res = await apiFetch('/users/save', jsonBody({
        id: form.id,
        username: form.username,
        role: form.role,
        password: form.password || undefined,
      }));
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Could not save the user.');
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

  const remove = async (u: User) => {
    if (!window.confirm(`Delete the user "${u.username}"? They will be signed out and can no longer log in.`)) return;
    setPageError('');
    try {
      const res = await apiFetch(`/users/delete/${u.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setPageError(data.error || 'Could not delete the user.');
        return;
      }
      load();
    } catch {
      // a 401 has already sent us back to login
    }
  };

  return (
    <section className="calc-panel users-panel">
      <div className="dash-panel-head">
        <div>
          <h2 className="panel-label">Users</h2>
          <p className="stat-sub" style={{ margin: 0 }}>Everyone signs in with their own username and password.</p>
        </div>
        <button className="new-order-btn" onClick={openNew}>New User</button>
      </div>

      {pageError && <p className="error-text">{pageError}</p>}

      {loading ? (
        <p className="empty-state">Loading…</p>
      ) : (
        <div className="orders-table-wrap">
          <table className="items-table users-table">
            <thead>
              <tr>
                <th>Username</th>
                <th>Role</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <span className="cell-main">{u.username}</span>
                    {u.is_me && <span className="cell-sub">You</span>}
                  </td>
                  <td><span className={`role-pill is-${u.role}`}>{ROLE_LABELS[u.role] ?? u.role}</span></td>
                  <td>
                    <div className="user-actions">
                      <button className="order-edit-btn" onClick={() => openEdit(u)}>Edit</button>
                      {!u.is_me && <button className="order-edit-btn danger-link" onClick={() => remove(u)}>Delete</button>}
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr><td colSpan={3}><span className="empty-state">No users yet.</span></td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {form && (
        <div className="modal-backdrop">
          <div className="modal-card types-card">
            <div className="modal-header">
              <h2 className="panel-label">{form.id ? 'Edit user' : 'New user'}</h2>
              <button className="item-remove" onClick={() => setForm(null)} aria-label="Close">×</button>
            </div>

            <div className="order-field" style={{ marginBottom: 14 }}>
              <label>Username</label>
              <input
                className="item-input"
                placeholder="e.g. aeindraaung"
                value={form.username}
                autoCapitalize="none"
                autoFocus
                onChange={(e) => setForm({ ...form, username: e.target.value })}
              />
              <p className="stat-sub" style={{ margin: '4px 0 0' }}>Letters, numbers, dots, dashes or underscores. Not case sensitive.</p>
            </div>

            <div className="order-field" style={{ marginBottom: 14 }}>
              <label>Role</label>
              <select
                className="item-input"
                value={form.role}
                disabled={form.isMe}
                onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
              >
                {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
              <p className="stat-sub" style={{ margin: '4px 0 0' }}>
                {form.isMe ? "You can't change your own role." : ROLE_HINTS[form.role]}
              </p>
            </div>

            <div className="order-field" style={{ marginBottom: 14 }}>
              <label>{form.id ? 'New password (leave empty to keep the current one)' : 'Password (at least 8 characters)'}</label>
              <input
                type="password"
                className="item-input"
                value={form.password}
                autoComplete="new-password"
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </div>

            {error && <p className="error-text">{error}</p>}

            <div className="order-form-actions">
              <button className="save-btn" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : form.id ? 'Save changes' : 'Add user'}
              </button>
              <button className="add-item-btn" onClick={() => setForm(null)} disabled={saving}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
