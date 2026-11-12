import assert from "node:assert/strict";

const URL_ = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const H = { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" };

async function select(table) {
  const r = await fetch(`${URL_}/rest/v1/${table}?select=*`, { headers: H });
  return { status: r.status, body: await r.json() };
}
async function rpc(nom, args) {
  const r = await fetch(`${URL_}/rest/v1/rpc/${nom}`, { method: "POST", headers: H, body: JSON.stringify(args) });
  const texte = await r.text();
  return { status: r.status, body: texte ? JSON.parse(texte) : null };
}

for (const t of ["foyers", "participants", "editions", "tirages", "envies", "config"]) {
  const { status, body } = await select(t);
  assert.ok(status >= 400 || (Array.isArray(body) && body.length === 0), `table ${t} lisible avec anon (status ${status})`);
}
assert.equal((await rpc("moi", { p_jeton: "faux" })).body, null);
assert.equal((await rpc("mon_tirage", { p_jeton: "faux" })).body, null);
assert.equal((await rpc("verifier_admin", { p_mdp: "faux" })).body, false);
assert.ok((await rpc("admin_etat", { p_mdp: "faux" })).status >= 400, "admin_etat accepte un faux mot de passe");
const tir = await rpc("enregistrer_tirage", { p_edition_id: "00000000-0000-0000-0000-000000000000", p_paires: [] });
assert.ok(tir.status >= 400, "enregistrer_tirage appelable avec anon");
const inj = await rpc("ajouter_envie", { p_jeton: "faux", p_texte: "x", p_lien: "javascript:alert(1)" });
assert.equal(inj.body, null);
console.log("securite : OK");
