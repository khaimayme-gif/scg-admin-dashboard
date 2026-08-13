import { useState } from 'react';

const API_BASE = '/api';

interface LoginProps {
  onSuccess: () => void;
}

export default function Login({ onSuccess }: LoginProps) {
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting'>('idle');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('submitting');
    setErrorMsg('');
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        // The server explains rate limiting and misconfiguration in its error body; fall
        // back to the generic message if there isn't one.
        let message = 'Incorrect password.';
        try {
          const data = await res.json();
          if (data?.error) message = data.error;
        } catch {
          // no JSON body, keep the default
        }
        setErrorMsg(message);
        setStatus('idle');
        return;
      }
      onSuccess();
    } catch {
      setErrorMsg('Could not reach the server. Check your connection and try again.');
      setStatus('idle');
    }
  };

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-brand">SCG Admin</div>
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="item-input"
          autoFocus
        />
        <button type="submit" className="calculate-btn" disabled={status === 'submitting'}>
          {status === 'submitting' ? 'Checking…' : 'Unlock'}
        </button>
        {errorMsg && <p className="error-text">{errorMsg}</p>}
      </form>
    </div>
  );
}