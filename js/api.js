import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });

function code(err) {
  const m = `${err?.message ?? ""} ${err?.details ?? ""}`;
  if (m.includes("non_autorise")) return "non_autorise";
  if (m.includes("trop_d_envies")) return "trop_d_envies";
  if (m.includes("envies_lien_check")) return "lien_invalide";
  if (m.includes("envies_texte_check")) return "texte_invalide";
  if (m.includes("Failed to fetch") || m.includes("NetworkError")) return "reseau";
  return "erreur";
}

export async function appel(nom, args) {
  let res;
  try { res = await sb.rpc(nom, args); } catch (e) { throw new Error(code(e)); }
  if (res.error) throw new Error(code(res.error));
  return res.data;
}

export async function lancerTirage(mdp, editionId) {
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/lancer_tirage`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ mot_de_passe: mdp, edition_id: editionId }),
    });
    return await r.json();
  } catch {
    return { ok: false, raison: "reseau" };
  }
}
