const API_BASE = '/api';

export class UnauthorizedError extends Error {
  constructor() {
    super('Session expired');
    this.name = 'UnauthorizedError';
  }
}

// App.tsx registers a callback here so an expired session sends the user back to the login
// screen. Without it, every data fetch quietly 401s and the UI just renders empty, which looks
// like the API has broken rather than like being logged out.
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler;
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${API_BASE}${path}`, { credentials: 'include', ...init });
  if (res.status === 401) {
    onUnauthorized?.();
    throw new UnauthorizedError();
  }
  return res;
}

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(path, init);
  if (!res.ok) throw new Error(`Request to ${path} failed with ${res.status}`);
  return res.json() as Promise<T>;
}

function jsonBody(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export { apiJson, jsonBody };
