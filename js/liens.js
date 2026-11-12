// Validation des liens d'envies, sans dépendance (testée sous Node).

const HTTP = /^https?:\/\//i;

// Vide = pas de lien (accepté). Sinon : http(s), URL analysable, sans espace.
export function lienValide(lien) {
  const s = (lien ?? "").trim();
  if (!s) return true;
  return domaine(s) !== null;
}

// Nom d'hôte d'un lien http(s), ou null s'il est absent ou mal formé.
export function domaine(lien) {
  // Les navigateurs encodent les espaces (« exemple.fr%20x ») là où Node refuse : on les rejette nous-mêmes.
  if (!lien || !HTTP.test(lien) || /\s/.test(lien.trim())) return null;
  try {
    const u = new URL(lien);
    return u.hostname || null;
  } catch {
    return null;
  }
}
