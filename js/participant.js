import { appel } from "./api.js";
import { t, traduire, brancherSelecteur, formaterDate } from "./i18n.js";
import { lienValide, domaine } from "./liens.js";
import { brancherRevelation } from "./revelation.js";
import { normaliserCode, codePlausible } from "./code.js";

let revelationBranchee = false;

const $ = (id) => document.getElementById(id);
let jeton = new URLSearchParams(location.search).get("t") ?? "";
let moi = null, tirage = null, envies = [];

function el(tag, props = {}, enfants = []) {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...enfants);
  return n;
}
function message(texte) { $("message").textContent = texte; $("message").hidden = !texte; }
function erreurEnvie(e) {
  const cle = { lien_invalide: "erreur_lien", texte_invalide: "erreur_texte", trop_d_envies: "erreur_trop_d_envies", reseau: "erreur_reseau" }[e.message] ?? "erreur_generique";
  message(t(cle));
}
function verifier(texte, lien) {
  if (!texte.trim() || texte.trim().length > 500) return t("erreur_texte");
  if (!lienValide(lien)) return t("erreur_lien");
  return "";
}
function lienEnvie(v) {
  const enfants = [el("span", { textContent: v.texte })];
  const hote = domaine(v.lien);
  if (hote) {
    enfants.push(" ", el("a", { href: v.lien, textContent: hote, target: "_blank", rel: "noopener noreferrer" }));
  }
  return enfants;
}

function afficher() {
  $("bonjour").textContent = t("bonjour", { prenom: moi.prenom });
  $("bloc-tirage").hidden = false; $("bloc-envies").hidden = false;
  const ed = moi.edition;
  $("pas-edition").hidden = !!ed;
  $("pas-tire").hidden = !ed || tirage.statut === "tire";
  $("tire").hidden = !ed || tirage.statut !== "tire";
  if (ed && tirage.statut === "tire") {
    $("receveur").textContent = tirage.receveur;
    $("infos").textContent = [ed.budget && t("budget", { budget: ed.budget }), ed.date_echange && t("date", { date: formaterDate(ed.date_echange) })].filter(Boolean).join(" · ");
    $("titre-envies-receveur").textContent = t("envies_de", { prenom: tirage.receveur });
    $("envies-receveur").replaceChildren(...(tirage.envies.length
      ? tirage.envies.map((v) => el("li", {}, lienEnvie(v)))
      : [el("li", { className: "muet", textContent: t("aucune_envie_receveur", { prenom: tirage.receveur }) })]));
    if (!revelationBranchee) {
      revelationBranchee = true;
      brancherRevelation({
        couvercle: $("couvercle"),
        interieur: $("interieur"),
        cle: `ss-ouvert-${ed.id}-${jeton.slice(0, 8)}`,
        apresOuverture: () => { const b = $("bloc-envies-receveur"); b.hidden = false; b.classList.add("apparait"); },
      });
    }
  }
  afficherMesEnvies();
}

function afficherMesEnvies() {
  $("mes-envies").replaceChildren(...(envies.length ? envies.map(ligneEnvie) : [el("li", { className: "muet", textContent: t("aucune_envie") })]));
}

function ligneEnvie(v) {
  const li = el("li");
  const lecture = () => {
    const mod = el("button", { className: "bouton secondaire", textContent: t("modifier"), onclick: edition });
    const sup = el("button", { className: "bouton danger", textContent: t("supprimer"), onclick: async () => {
      if (!confirm(t("confirmer_suppression"))) return;
      try { await appel("supprimer_envie", { p_jeton: jeton, p_id: v.id }); await rechargerEnvies(); } catch (e) { erreurEnvie(e); }
    } });
    li.replaceChildren(el("div", {}, lienEnvie(v)), el("div", { className: "ligne", style: "margin-top:6px" }, [mod, sup]));
  };
  const edition = () => {
    const texte = el("input", { value: v.texte, maxLength: 500 });
    const lien = el("input", { value: v.lien ?? "", type: "url", maxLength: 1000, placeholder: t("envie_lien") });
    const ok = el("button", { className: "bouton", textContent: t("enregistrer"), onclick: async () => {
      const err = verifier(texte.value, lien.value); if (err) return message(err);
      try { await appel("modifier_envie", { p_jeton: jeton, p_id: v.id, p_texte: texte.value, p_lien: lien.value }); message(""); await rechargerEnvies(); }
      catch (e) { erreurEnvie(e); }
    } });
    const ann = el("button", { className: "bouton secondaire", textContent: t("annuler"), onclick: lecture });
    li.replaceChildren(el("div", { className: "ligne" }, [texte]), el("div", { className: "ligne", style: "margin-top:6px" }, [lien, ok, ann]));
  };
  lecture();
  return li;
}

async function rechargerEnvies() { envies = await appel("mes_envies", { p_jeton: jeton }); afficherMesEnvies(); }

$("form-envie").onsubmit = async (ev) => {
  ev.preventDefault();
  const texte = $("envie-texte").value, lien = $("envie-lien").value;
  const err = verifier(texte, lien); if (err) return message(err);
  try {
    await appel("ajouter_envie", { p_jeton: jeton, p_texte: texte, p_lien: lien });
    $("envie-texte").value = ""; $("envie-lien").value = ""; message("");
    await rechargerEnvies();
  } catch (e) { erreurEnvie(e); }
};

// ---------- Accueil : code personnel, mémorisé sur l'appareil ----------
const CLE_JETON = "ss-jeton";
function memoriser(j) { try { j ? localStorage.setItem(CLE_JETON, j) : localStorage.removeItem(CLE_JETON); } catch {} }
function memorise() { try { return localStorage.getItem(CLE_JETON) ?? ""; } catch { return ""; } }

function afficherAccueil(cleMessage) {
  $("chargement").hidden = true;
  $("accueil").hidden = false;
  if (cleMessage) message(t(cleMessage));
  $("code").focus({ preventScroll: true });
}

$("form-code").onsubmit = async (ev) => {
  ev.preventDefault();
  const saisie = $("code").value;
  if (!codePlausible(saisie)) return message(t("code_format"));
  const bouton = $("form-code").querySelector("button");
  bouton.disabled = true;
  try {
    const j = await appel("jeton_par_code", { p_code: normaliserCode(saisie) });
    if (!j) return message(t("code_inconnu"));
    message("");
    $("accueil").hidden = true;
    $("chargement").hidden = false;
    jeton = j;
    memoriser(j);
    await charger("code_inconnu");
  } catch (e) {
    message(t(e.message === "reseau" ? "erreur_reseau" : "erreur_generique"));
  } finally {
    bouton.disabled = false;
  }
};

$("pas-moi").onclick = () => { memoriser(""); location.replace(location.pathname); };

async function charger(cleSiInvalide) {
  try {
    moi = await appel("moi", { p_jeton: jeton });
    if (!moi) { memoriser(""); jeton = ""; return afficherAccueil(cleSiInvalide); }
    [tirage, envies] = await Promise.all([appel("mon_tirage", { p_jeton: jeton }), appel("mes_envies", { p_jeton: jeton })]);
  } catch (e) {
    $("chargement").hidden = true;
    return message(t(e.message === "reseau" ? "erreur_reseau" : "erreur_generique"));
  }
  memoriser(jeton);
  $("chargement").hidden = true;
  $("pas-moi").hidden = false;
  afficher();
}

async function demarrer() {
  traduire();
  const depuisLien = !!jeton;
  if (!jeton) jeton = memorise();
  if (!jeton) return afficherAccueil();
  await charger(depuisLien ? "lien_invalide" : "code_expire");
}

brancherSelecteur($("langue"), () => moi && afficher());
demarrer();
