import { appel } from "./api.js";
import { t, traduire, brancherSelecteur, formaterDate } from "./i18n.js";

const $ = (id) => document.getElementById(id);
const jeton = new URLSearchParams(location.search).get("t") ?? "";
let moi = null, tirage = null, envies = [];

const LIEN_OK = /^https?:\/\//i;
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
  if (lien.trim() && !LIEN_OK.test(lien.trim())) return t("erreur_lien");
  return "";
}
function lienEnvie(v) {
  const enfants = [el("span", { textContent: v.texte })];
  if (v.lien && LIEN_OK.test(v.lien)) {
    enfants.push(" ", el("a", { href: v.lien, textContent: new URL(v.lien).hostname, target: "_blank", rel: "noopener noreferrer" }));
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

async function demarrer() {
  traduire();
  if (!jeton) { $("chargement").hidden = true; return message(t("lien_invalide")); }
  try {
    moi = await appel("moi", { p_jeton: jeton });
    if (!moi) { $("chargement").hidden = true; return message(t("lien_invalide")); }
    [tirage, envies] = await Promise.all([appel("mon_tirage", { p_jeton: jeton }), appel("mes_envies", { p_jeton: jeton })]);
  } catch (e) {
    $("chargement").hidden = true;
    return message(t(e.message === "reseau" ? "erreur_reseau" : "erreur_generique"));
  }
  $("chargement").hidden = true;
  afficher();
}

brancherSelecteur($("langue"), () => moi && afficher());
demarrer();
