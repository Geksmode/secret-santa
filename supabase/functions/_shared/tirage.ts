// Algorithme pur du tirage Secret Santa. Aucune dépendance : importé par
// l'Edge Function (Deno) et par les tests (Node 24, type stripping).
// N'utiliser que de la syntaxe TS « effaçable » (pas d'enum, pas de namespace).
//
// Règles absolues : personne ne se tire soi-même ni son conjoint.
// Règle souple : pas quelqu'un de sa famille (et pas la personne de `precedent`, si fourni).
// Si la règle souple ne peut pas être respectée pour tout le monde (ex. familles de 6 et 4),
// on fait le mieux possible : le MINIMUM d'« entorses », tiré au hasard parmi tous les tirages
// qui atteignent ce minimum.

export type Participant = { id: string; foyer: string | null; conjoint?: string | null };
export type Paire = { donneur: string; receveur: string };
export type Resultat =
  | { ok: true; paires: Paire[]; entorses: number }
  | { ok: false; raison: "trop_peu" | "impossible" };

const ESSAIS_PAR_REJET = 5000;
const INTERDIT = 1e6; // coût de « soi-même » ou « son conjoint » : jamais retenu
const ENTORSE = 1000; // coût d'un cadeau dans la même famille ; le bruit aléatoire reste < 1

export function estAutorise(d: Participant, r: Participant, precedent: Map<string, string>): boolean {
  if (d.id === r.id) return false;
  if (d.conjoint && d.conjoint === r.id) return false;
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

// Affectation de coût minimal (méthode hongroise, O(n³)) : renvoie le receveur (indice) de chaque donneur.
function affectationMin(cout: number[][]): number[] {
  const n = cout.length;
  const u = new Array<number>(n + 1).fill(0), v = new Array<number>(n + 1).fill(0);
  const p = new Array<number>(n + 1).fill(0), chemin = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(n + 1).fill(Infinity);
    const vu = new Array<boolean>(n + 1).fill(false);
    do {
      vu[j0] = true;
      const i0 = p[j0];
      let delta = Infinity, j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (vu[j]) continue;
        const c = cout[i0 - 1][j - 1] - u[i0] - v[j];
        if (c < minv[j]) { minv[j] = c; chemin[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= n; j++) {
        if (vu[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = chemin[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const res = new Array<number>(n);
  for (let j = 1; j <= n; j++) res[p[j] - 1] = j - 1;
  return res;
}

export function tirer(
  participants: Participant[],
  precedent: Map<string, string>,
  rng: () => number = Math.random,
): Resultat {
  const n = participants.length;
  if (n < 2) return { ok: false, raison: "trop_peu" };

  const interdit = participants.map((d, i) => participants.map((r, j) => i === j || (!!d.conjoint && d.conjoint === r.id)));
  const soi = (d: number, r: number) => interdit[d][r];
  const entorse = participants.map((d, i) => participants.map((r, j) => !interdit[i][j] && !estAutorise(d, r, precedent)));
  const compter = (perm: number[]) => perm.reduce((s, r, d) => s + (entorse[d][r] ? 1 : 0), 0);
  const valide = (perm: number[]) => perm.every((r, d) => !soi(d, r));
  const enPaires = (perm: number[], entorses: number): Resultat => ({
    ok: true,
    entorses,
    paires: perm.map((r, d) => ({ donneur: participants[d].id, receveur: participants[r].id })),
  });
  const indices = [...Array(n).keys()];

  // 1) Cas normal : échantillonnage par rejet, uniforme parmi les tirages sans aucune entorse.
  for (let e = 0; e < ESSAIS_PAR_REJET; e++) {
    const perm = melanger(indices, rng);
    if (valide(perm) && compter(perm) === 0) return enPaires(perm, 0);
  }

  // 2) Minimum exact d'entorses (méthode hongroise ; le bruit aléatoire départage les solutions).
  const cout = indices.map((d) => indices.map((r) => (soi(d, r) ? INTERDIT : entorse[d][r] ? ENTORSE : 0) + rng() * 0.5));
  const optimal = affectationMin(cout);
  if (!valide(optimal)) return { ok: false, raison: "impossible" };
  const minimum = compter(optimal);

  // 3) Uniforme parmi les tirages qui atteignent ce minimum, si on en trouve par rejet ; sinon l'optimal trouvé.
  if (minimum > 0) {
    for (let e = 0; e < ESSAIS_PAR_REJET; e++) {
      const perm = melanger(indices, rng);
      if (valide(perm) && compter(perm) === minimum) return enPaires(perm, minimum);
    }
  }
  return enPaires(optimal, minimum);
}
