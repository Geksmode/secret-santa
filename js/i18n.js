import { TEXTES } from "./textes.js";

const CLE = "ss-langue";
let courante = (() => {
  try { const l = localStorage.getItem(CLE); if (l === "fr" || l === "en") return l; } catch {}
  return (navigator.language || "fr").toLowerCase().startsWith("fr") ? "fr" : "en";
})();

export function langue() { return courante; }

export function changerLangue(l) {
  courante = l === "en" ? "en" : "fr";
  try { localStorage.setItem(CLE, courante); } catch {}
  document.documentElement.lang = courante;
}

export function t(cle, vars = {}) {
  const s = TEXTES[courante][cle] ?? TEXTES.fr[cle] ?? cle;
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ""));
}

export function traduire(racine = document) {
  racine.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  racine.querySelectorAll("[data-i18n-placeholder]").forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  racine.querySelectorAll("[data-i18n-aria]").forEach((el) => { el.setAttribute("aria-label", t(el.dataset.i18nAria)); });
  document.title = t("titre");
}

export function brancherSelecteur(el, apres) {
  el.value = courante;
  el.addEventListener("change", () => { changerLangue(el.value); traduire(); apres(); });
}

export function formaterDate(iso) {
  if (!iso) return "";
  return new Date(iso + "T12:00:00").toLocaleDateString(courante === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "long", year: "numeric" });
}

changerLangue(courante);
