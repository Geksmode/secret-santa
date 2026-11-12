import { appel, lancerTirage } from "./api.js";
import { t, traduire, brancherSelecteur } from "./i18n.js";
import { formaterCode } from "./code.js";

const $ = (id) => document.getElementById(id);
const RAISONS_CONNUES = new Set(["trop_peu", "foyer_trop_grand", "impossible", "deja_tire", "edition_inconnue"]);
// Nombre de cadeaux restés dans une même famille (tirage assoupli), ou "" s'il n'y en a pas.
function noteMemeFamille(n) {
  if (!n) return "";
  return n === 1 ? t("meme_famille_1") : t("meme_famille_n", { n });
}
let mdp = (() => { try { return sessionStorage.getItem("ss-mdp") ?? ""; } catch { return ""; } })();
let etat = null;

function message(texte, info = false) {
  const m = $("message");
  m.textContent = texte; m.hidden = !texte; m.classList.toggle("info", info);
}
function erreur(e) {
  if (e.message === "non_autorise") { deconnecter(); message(t("mdp_faux")); return; }
  message(t(e.message === "reseau" ? "erreur_reseau" : "erreur_generique"));
}
function el(tag, props = {}, enfants = []) {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...enfants);
  return n;
}
function optionsFoyers(select, valeur) {
  select.replaceChildren(el("option", { value: "", textContent: t("sans_foyer") }),
    ...etat.foyers.map((f) => el("option", { value: f.id, textContent: f.nom })));
  select.value = valeur ?? "";
}

function deconnecter() {
  mdp = ""; try { sessionStorage.removeItem("ss-mdp"); } catch {}
  $("contenu").hidden = true; $("connexion").hidden = false; $("deconnexion").hidden = true;
}

async function charger() {
  try { etat = await appel("admin_etat", { p_mdp: mdp }); } catch (e) { return erreur(e); }
  $("connexion").hidden = true; $("contenu").hidden = false; $("deconnexion").hidden = false;
  afficher();
  const liens = await appel("admin_liens", { p_mdp: mdp }).catch(() => []);
  afficherLiens(liens);
}

function afficher() {
  const ed = etat.edition;
  $("annee").value = ed?.annee ?? new Date().getFullYear();
  $("budget").value = ed?.budget ?? "";
  $("date").value = ed?.date_echange ?? "";
  $("etat-tirage").textContent = ed?.tiree ? [t("tirage_deja_fait"), noteMemeFamille(ed.meme_famille)].filter(Boolean).join(" ") : "";
  $("a-refaire").hidden = !etat.tirage_a_refaire;
  $("lancer").disabled = !ed || ed.tiree;
  $("annuler").disabled = !ed || !ed.tiree;

  $("liste-foyers").replaceChildren(...etat.foyers.map((f) => {
    const nom = el("input", { value: f.nom, maxLength: 80 });
    const ok = el("button", { className: "bouton secondaire", textContent: t("enregistrer"), onclick: () => action("admin_foyer_renommer", { p_id: f.id, p_nom: nom.value }) });
    const sup = el("button", { className: "bouton danger", textContent: t("supprimer"), onclick: () => action("admin_foyer_supprimer", { p_id: f.id }) });
    return el("li", {}, [el("div", { className: "ligne" }, [nom, ok, sup])]);
  }));

  optionsFoyers($("foyer-participant"));
  $("liste-participants").replaceChildren(...etat.participants.map((p) => {
    const prenom = el("input", { value: p.prenom, maxLength: 80 });
    const foyer = el("select"); optionsFoyers(foyer, p.foyer_id);
    const actif = el("input", { type: "checkbox", checked: p.actif });
    const lab = el("label", { className: "muet" }, [actif, " " + t("actif")]);
    const ok = el("button", { className: "bouton secondaire", textContent: t("enregistrer"),
      onclick: () => action("admin_participant_modifier", { p_id: p.id, p_prenom: prenom.value, p_foyer_id: foyer.value || null, p_actif: actif.checked }) });
    return el("li", {}, [el("div", { className: "ligne" }, [prenom, foyer, lab, ok])]);
  }));
}

function afficherLiens(liens) {
  const base = new URL("./", location.href).href;
  $("liste-liens").replaceChildren(...liens.map((l) => {
    const url = `${base}?t=${l.jeton}`;
    const b = el("button", { className: "bouton secondaire", textContent: t("copier") });
    b.onclick = async () => {
      try { await navigator.clipboard.writeText(url); b.textContent = t("copie"); }
      catch { window.prompt(l.prenom, url); }
    };
    const nom = el("span", { style: "flex:1" }, [l.prenom, " · ", el("span", { className: "code-perso", textContent: formaterCode(l.code ?? "") })]);
    return el("li", {}, [el("div", { className: "ligne" }, [nom, b])]);
  }));
}

async function action(nom, args) {
  message("");
  try { await appel(nom, { p_mdp: mdp, ...args }); } catch (e) { return erreur(e); }
  await charger();
}

$("form-connexion").onsubmit = async (ev) => {
  ev.preventDefault();
  const essai = $("mdp").value;
  let ok = false;
  try { ok = await appel("verifier_admin", { p_mdp: essai }); } catch (e) { return erreur(e); }
  if (!ok) return message(t("mdp_faux"));
  mdp = essai; try { sessionStorage.setItem("ss-mdp", mdp); } catch {}
  $("mdp").value = ""; message(""); charger();
};
$("deconnexion").onclick = deconnecter;
$("form-edition").onsubmit = (ev) => {
  ev.preventDefault();
  action("admin_enregistrer_edition", { p_annee: +$("annee").value, p_budget: $("budget").value, p_date: $("date").value || null });
};
$("form-foyer").onsubmit = (ev) => {
  ev.preventDefault();
  action("admin_foyer_ajouter", { p_nom: $("nom-foyer").value }).then(() => ($("nom-foyer").value = ""));
};
$("form-participant").onsubmit = (ev) => {
  ev.preventDefault();
  action("admin_participant_ajouter", { p_prenom: $("prenom").value, p_foyer_id: $("foyer-participant").value || null })
    .then(() => ($("prenom").value = ""));
};
$("lancer").onclick = async () => {
  $("lancer").disabled = true; message("");
  const r = await lancerTirage(mdp, etat.edition.id);
  if (r.ok) message([t("tirage_fait", { nb: r.nb }), noteMemeFamille(r.meme_famille)].filter(Boolean).join(" "), true);
  else if (r.raison === "non_autorise") { deconnecter(); message(t("mdp_faux")); return; }
  else if (r.raison === "reseau") message(t("erreur_reseau"));
  else message(RAISONS_CONNUES.has(r.raison) ? t(`raison_${r.raison}`, { foyer: r.detail ?? "" }) : t("erreur_generique"));
  charger();
};
$("annuler").onclick = () => { if (confirm(t("confirmer_annulation"))) action("admin_annuler_tirage", { p_edition_id: etat.edition.id }); };

brancherSelecteur($("langue"), () => etat && charger());
traduire();
if (mdp) charger();
