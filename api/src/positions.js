import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

// Order is kept with fractional-index keys: placing an item at `index` in a list (the list without that
// item) gives it a key between its new neighbours, so no other row changes. If two writers ever produced
// equal keys, the list is renumbered once and the key computed again.
//
// `list` is a function returning [{ id, position }] in order; `rename` writes a fresh key for one id.
export async function keyAt(t, { list, rename, index }) {
  let rows = await list();
  const at = Math.max(0, Math.min(index ?? rows.length, rows.length));
  try {
    return generateKeyBetween(rows[at - 1]?.position ?? null, rows[at]?.position ?? null);
  } catch {
    const keys = generateNKeysBetween(null, null, rows.length);
    for (let i = 0; i < rows.length; i++) await rename(rows[i].id, keys[i]);
    rows = await list();
    return generateKeyBetween(rows[at - 1]?.position ?? null, rows[at]?.position ?? null);
  }
}
