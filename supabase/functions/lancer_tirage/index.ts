import { createClient } from "jsr:@supabase/supabase-js@2";
import { tirer, type Participant } from "../_shared/tirage.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, raison: "methode" }, 405);

  let corps: { mot_de_passe?: string; edition_id?: string };
  try { corps = await req.json(); } catch { return json({ ok: false, raison: "requete" }, 400); }

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: estAdmin } = await db.rpc("verifier_admin", { p_mdp: corps.mot_de_passe ?? "" });
  if (!estAdmin) return json({ ok: false, raison: "non_autorise" });

  const { data: ed } = await db.from("editions").select("id, annee, tiree").eq("id", corps.edition_id ?? "").maybeSingle();
  if (!ed) return json({ ok: false, raison: "edition_inconnue" });
  if (ed.tiree) return json({ ok: false, raison: "deja_tire" });

  const { data: ps, error: e1 } = await db.from("participants").select("id, foyer_id").eq("actif", true);
  if (e1) return json({ ok: false, raison: "erreur" }, 500);
  const participants: Participant[] = ps.map((p) => ({ id: p.id, foyer: p.foyer_id }));

  // Règle unique : pas soi-même, pas sa propre famille (pas de règle « an dernier », choix de Thanh Huy).
  const res = tirer(participants, new Map(),() => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296);
  if (!res.ok) {
    if (res.raison === "foyer_trop_grand" && res.detail) {
      const { data: f } = await db.from("foyers").select("nom").eq("id", res.detail).maybeSingle();
      return json({ ok: false, raison: res.raison, detail: f?.nom ?? "" });
    }
    return json({ ok: false, raison: res.raison });
  }

  const { error: e2 } = await db.rpc("enregistrer_tirage", { p_edition_id: ed.id, p_paires: res.paires });
  if (e2) return json({ ok: false, raison: e2.message.includes("deja_tire") ? "deja_tire" : "erreur" }, e2.message.includes("deja_tire") ? 200 : 500);
  return json({ ok: true, nb: res.paires.length });
});
