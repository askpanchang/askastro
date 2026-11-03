/** Opaque keyset cursor for (created_at DESC, id DESC) pagination. */
export type Cursor = { createdAt: string; id: string };

export function encodeCursor(c: Cursor): string {
  return btoa(`${c.createdAt}|${c.id}`).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeCursor(s: string): Cursor | null {
  try {
    const raw = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    const [createdAt, id, ...rest] = raw.split('|');
    if (!createdAt || !id || rest.length) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}
