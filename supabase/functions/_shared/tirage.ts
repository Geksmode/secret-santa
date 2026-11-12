// Algorithme pur du tirage Secret Santa. Aucune dépendance : importé par
// l'Edge Function (Deno) et par les tests (Node 24, type stripping).
// N'utiliser que de la syntaxe TS « effaçable » (pas d'enum, pas de namespace).

export type Participant = { id: string; foyer: string | null };
export type Paire = { donneur: string; receveur: string };
export type Resultat =
  | { ok: true; paires: Paire[] }
  | { ok: false; raison: "trop_peu" | "foyer_trop_grand" | "impossible"; detail?: string };

const ESSAIS_PAR_REJET = 5000;

export function estAutorise(d: Participant, r: Participant, precedent: Map<string, string>): boolean {
  if (d.id === r.id) return false;
  if (d.foyer !== null && d.foyer === r.foyer) return false;
  if (precedent.get(d.id) === r.id) return false;
  return true;
}

function melanger<T>(t: T[], rng: () => number): T[] {
  const a = t.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Appariement parfait par chemins augmentants (algorithme de Kuhn), ordre aléatoire.
// Retourne receveurParDonneur (indices) ou null si aucun appariement complet.
function apparier(n: number, autorise: boolean[][], rng: () => number): number[] | null {
  const donneurDuReceveur = new Array<number>(n).fill(-1);
  const voisins = autorise.map((ligne) => melanger(ligne.flatMap((ok, j) => (ok ? [j] : [])), rng));
  const essayer = (d: number, vu: boolean[]): boolean => {
    for (const r of voisins[d]) {
      if (vu[r]) continue;
      vu[r] = true;
      if (donneurDuReceveur[r] === -1 || essayer(donneurDuReceveur[r], vu)) {
        donneurDuReceveur[r] = d;
        return true;
      }
    }
    return false;
  };
  for (const d of melanger([...Array(n).keys()], rng)) {
    if (!essayer(d, new Array<boolean>(n).fill(false))) return null;
  }
  const res = new Array<number>(n);
  donneurDuReceveur.forEach((d, r) => (res[d] = r));
  return res;
}

export function tirer(
  participants: Participant[],
  precedent: Map<string, string>,
  rng: () => number = Math.random,
): Resultat {
  const n = participants.length;
  if (n < 2) return { ok: false, raison: "trop_peu" };

  const tailles = new Map<string, number>();
  for (const p of participants) if (p.foyer !== null) tailles.set(p.foyer, (tailles.get(p.foyer) ?? 0) + 1);
  for (const [foyer, k] of tailles) if (k > n - k) return { ok: false, raison: "foyer_trop_grand", detail: foyer };

  const autorise = participants.map((d) => participants.map((r) => estAutorise(d, r, precedent)));
  const enPaires = (rec: number[]): Resultat => ({
    ok: true,
    paires: rec.map((r, d) => ({ donneur: participants[d].id, receveur: participants[r].id })),
  });

  // 1) Échantillonnage par rejet : uniforme parmi les tirages valides.
  const indices = [...Array(n).keys()];
  for (let e = 0; e < ESSAIS_PAR_REJET; e++) {
    const perm = melanger(indices, rng);
    if (perm.every((r, d) => autorise[d][r])) return enPaires(perm);
  }
  // 2) Repli : appariement aléatoire (pas parfaitement uniforme), exact pour détecter l'impossible.
  const rec = apparier(n, autorise, rng);
  return rec ? enPaires(rec) : { ok: false, raison: "impossible" };
}
