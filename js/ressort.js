// Ressort physique façon Apple : deux paramètres lisibles au lieu de masse/raideur/frottement.
//  - amortissement : 1 = critique (aucun dépassement), < 1 = rebondit (0.8 après un geste lancé)
//  - reponse : rapidité en secondes (ce n'est pas une durée fixe)
// Pur et sans DOM : testé sous Node ; la boucle d'animation est dans animer().

const PAS_MAX = 0.004; // sous-pas d'intégration (s), stable même si une image arrive en retard

export function creerRessort({ de, vers, vitesse = 0, amortissement = 1, reponse = 0.4 }) {
  const w = (2 * Math.PI) / reponse;
  return { x: de, v: vitesse, vers, k: w * w, c: 2 * amortissement * w, arrete: false };
}

export function avancer(r, dt) {
  if (r.arrete) return r;
  const n = Math.max(1, Math.ceil(dt / PAS_MAX));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    const a = -r.k * (r.x - r.vers) - r.c * r.v;
    r.v += a * h;
    r.x += r.v * h;
  }
  if (Math.abs(r.v) < 1 && Math.abs(r.x - r.vers) < 0.3) {
    r.x = r.vers; r.v = 0; r.arrete = true;
  }
  return r;
}

// Boucle requestAnimationFrame. Renvoie { arreter() } ; l'appelant lit r.x / r.v pour reprendre
// depuis la valeur affichée (interruption sans saut).
export function animer(r, aChaqueImage, fin) {
  let t0 = null, id = 0, actif = true;
  const image = (t) => {
    if (!actif) return;
    const dt = t0 === null ? 1 / 60 : Math.min((t - t0) / 1000, 0.1);
    t0 = t;
    avancer(r, dt);
    aChaqueImage(r.x, r.v);
    if (r.arrete) { actif = false; fin?.(); return; }
    id = requestAnimationFrame(image);
  };
  id = requestAnimationFrame(image);
  return { arreter() { actif = false; cancelAnimationFrame(id); } };
}

// Point d'arrivée projeté d'un geste lancé (fonction d'Apple, décélération exponentielle).
export function projeter(vitesse, deceleration = 0.998) {
  return ((vitesse / 1000) * deceleration) / (1 - deceleration);
}

// Résistance élastique au-delà d'une limite : plus on tire, moins ça suit.
export function elastique(depassement, dimension, constante = 0.55) {
  return (depassement * dimension * constante) / (dimension + constante * Math.abs(depassement));
}
