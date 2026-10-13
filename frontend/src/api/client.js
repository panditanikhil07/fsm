// Single place that knows how to talk to the FSM backend.
const BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Unable to connect to the FSM backend.', 0);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(json.error || `${path} failed (${res.status})`, res.status);
  return json;
}

const get = (path) => request(path);
const post = (path, body = {}) => request(path, { method: 'POST', body });
const enc = encodeURIComponent;

export const api = {
  // live engine
  states: () => get('/states'),
  customers: () => get('/customers'),
  startSession: (body) => post('/session', body),
  resetSession: (body) => post('/session/reset', body),
  turn: (body) => post('/turn', body),
  endSession: (sessionId) => post('/session/end', { session_id: sessionId }),

  // script library
  listScripts: () => get('/scripts'),
  getScript: (name) => get(`/scripts/${enc(name)}`),
  saveScript: (name, script) => post(`/scripts/${enc(name)}`, script),
  activateScript: (name) => post(`/scripts/active/${enc(name)}`),
  getActiveScript: () => get('/scripts/active'),
};
