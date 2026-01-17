export function getApiBase() {
  const raw = import.meta.env.VITE_API_BASE || '';
  if (!raw) return '';
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}
