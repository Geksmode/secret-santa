// Paquet cadeau à ouvrir (skill apple-design) :
// - toucher / clic / Entrée / Espace : ouverture par ressort critique (aucun rebond) ;
// - glisser vers le haut : suit le doigt 1:1 depuis le point saisi, résistance élastique vers le bas,
//   au relâchement on projette l'élan et on passe la vitesse au ressort (léger rebond s'il a été lancé) ;
// - interruptible à tout instant : on reprend depuis la position affichée ;
// - « réduire les animations » : simple fondu, pas de glissé ;
// - seules transform et opacity changent pendant le mouvement (fluide sur iPad).
import { creerRessort, animer, projeter, elastique } from "./ressort.js";

const SEUIL_GLISSE = 10;   // px avant de considérer un glissé (sinon c'est un toucher)
const SEUIL_OUVERTURE = 0.4;

export function brancherRevelation({ couvercle, interieur, cle, apresOuverture }) {
  const reduit = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let y = 0;              // décalage du couvercle vers le haut (px)
  let anim = null;
  let ouvert = false;
  let touche = false;     // l'utilisateur a déjà interagi (pas d'indice ensuite)
  let geste = null;

  const hauteur = () => couvercle.offsetHeight + 24;

  function afficher(val) {
    y = val;
    const H = hauteur();
    const p = Math.min(Math.max(val / H, 0), 1);
    couvercle.style.transform = `translate3d(0, ${-val}px, 0) rotate(${-p * 4}deg)`;
    couvercle.style.opacity = String(1 - Math.max(0, (p - 0.55) / 0.45));
    interieur.style.transform = `scale(${0.94 + 0.06 * p})`;
    interieur.style.opacity = String(0.25 + 0.75 * p);
  }

  function terminer() {
    ouvert = true;
    couvercle.hidden = true;
    couvercle.parentElement.classList.add("ouverte");
    interieur.style.transform = "";
    interieur.style.opacity = "";
    interieur.removeAttribute("aria-hidden");
    try { localStorage.setItem(cle, "1"); } catch {}
    apresOuverture();
  }

  function allerVers(cible, { vitesse = 0, amortissement = 1, reponse = 0.4 } = {}) {
    anim?.arreter();
    const r = creerRessort({ de: y, vers: cible, vitesse, amortissement, reponse });
    anim = animer(r, afficher, () => { anim = null; if (cible > 0) terminer(); });
  }

  function ouvrir() {
    if (ouvert) return;
    touche = true;
    if (reduit) {
      couvercle.classList.add("ouvert-doux");
      interieur.style.opacity = "";
      setTimeout(terminer, 200);
      return;
    }
    allerVers(hauteur(), { reponse: 0.45 });
  }

  // Déjà ouvert lors d'une visite précédente : pas de paquet.
  let dejaOuvert = false;
  try { dejaOuvert = localStorage.getItem(cle) === "1"; } catch {}
  if (dejaOuvert) { terminer(); return; }

  interieur.setAttribute("aria-hidden", "true");
  afficher(0);

  // Clavier (Entrée / Espace) : click sans pointeur (detail === 0).
  couvercle.addEventListener("click", (e) => { if (e.detail === 0) ouvrir(); });

  couvercle.addEventListener("pointerdown", (e) => {
    if (ouvert || e.button > 0) return;
    touche = true;
    anim?.arreter(); anim = null;      // on attrape le paquet en plein vol
    try { couvercle.setPointerCapture(e.pointerId); } catch {} // suivi même si le doigt sort du paquet
    geste = { id: e.pointerId, y0: e.clientY, depart: y, glisse: false, histo: [{ t: e.timeStamp, y: e.clientY }] };
  });

  couvercle.addEventListener("pointermove", (e) => {
    if (!geste || e.pointerId !== geste.id) return;
    const dy = geste.y0 - e.clientY;   // > 0 vers le haut
    if (!geste.glisse && Math.abs(dy) < SEUIL_GLISSE) return;
    if (reduit) return;
    geste.glisse = true;
    geste.histo.push({ t: e.timeStamp, y: e.clientY });
    if (geste.histo.length > 6) geste.histo.shift();
    const brut = geste.depart + dy;
    const H = hauteur();
    afficher(brut < 0 ? -elastique(-brut, H) : brut > H ? H + elastique(brut - H, H) : brut);
  });

  function relacher(e) {
    if (!geste || e.pointerId !== geste.id) return;
    const g = geste; geste = null;
    if (!g.glisse) { ouvrir(); return; }  // simple toucher
    // vitesse vers le haut (px/s) sur les 100 dernières ms : un doigt arrêté avant de lâcher = vitesse nulle
    g.histo.push({ t: e.timeStamp, y: e.clientY });
    const recents = g.histo.filter((p) => p.t >= e.timeStamp - 100);
    const a = recents[0], b = recents[recents.length - 1];
    const dt = (b.t - a.t) / 1000;
    const vitesse = recents.length < 2 || dt <= 0 ? 0 : (a.y - b.y) / dt;
    const H = hauteur();
    const arrivee = y + projeter(vitesse);
    const versHaut = arrivee > H * SEUIL_OUVERTURE;
    allerVers(versHaut ? H : 0, {
      vitesse,
      amortissement: Math.abs(vitesse) > 300 ? 0.8 : 1, // rebond seulement si le geste a été lancé
      reponse: 0.35,
    });
  }
  couvercle.addEventListener("pointerup", relacher);
  couvercle.addEventListener("pointercancel", relacher);

  // Indice dès l'arrivée (une seule fois, pas de boucle) : le couvercle se soulève un peu.
  if (!reduit) {
    setTimeout(() => {
      if (touche || ouvert) return;
      const r = creerRessort({ de: 0, vers: 22, reponse: 0.3 });
      anim = animer(r, afficher, () => {
        if (touche) return;
        const retour = creerRessort({ de: y, vers: 0, amortissement: 0.6, reponse: 0.35 });
        anim = animer(retour, afficher, () => { anim = null; });
      });
    }, 700);
  }
}
