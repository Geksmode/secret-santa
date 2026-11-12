// Code personnel à 8 caractères (alternative au lien). Doit rester identique à
// l'alphabet de public._code_aleatoire() dans supabase/migrations/20261112100000_codes.sql.
export const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // sans 0 O 1 I L

export function normaliserCode(saisie) {
  return String(saisie ?? "").toUpperCase().replace(/[\s-]/g, "");
}

export function formaterCode(code) {
  const c = normaliserCode(code);
  return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}

export function codePlausible(saisie) {
  const c = normaliserCode(saisie);
  return c.length === 8 && [...c].every((ch) => ALPHABET.includes(ch));
}
