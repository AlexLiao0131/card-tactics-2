/** Browser-only persistence boundary. Imported safely by Node/Workers without DOM. */
export function browserDeckStorage() {
  if (typeof window === 'undefined') return null;
  try { return window.localStorage || null; }
  catch { return null; }
}
