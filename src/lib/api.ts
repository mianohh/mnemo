const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");

/** Resolve an API path against the backend URL (empty = same origin). */
export function apiUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return `${API_URL}${path}`;
}

/** Fetch with the session cookie attached (cross-origin requires include). */
export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(apiUrl(path), { credentials: "include", ...init });
}
