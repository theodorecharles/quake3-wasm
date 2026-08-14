export function normalizePlayerName(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f"\\;]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 32) || 'Player';
}

export function cvarTokens(name, value) {
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error('unsafe cvar name');
  return ['+set', name, String(value).replace(/[\u0000-\u001f\u007f"\\;]/g, '')];
}
