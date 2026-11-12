import assert from "node:assert/strict";

const URL_ = process.env.SUPABASE_URL, ANON = process.env.SUPABASE_ANON_KEY;
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY, MDP = process.env.ADMIN_MDP_TEST;
const h = (k) => ({ apikey: k, Authorization: `Bearer ${k}`, "Content-Type": "application/json" });

async function rpc(nom, args) {
  const r = await fetch(`${URL_}/rest/v1/rpc/${nom}`, { method: "POST", headers: h(ANON), body: JSON.stringify(args) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${nom}: ${t}`);
  return t ? JSON.parse(t) : null;
}
async function lancer(edition_id, mot_de_passe = MDP) {
  const r = await fetch(`${URL_}/functions/v1/lancer_tirage`, { method: "POST", headers: h(ANON), body: JSON.stringify({ mot_de_passe, edition_id }) });
  return r.json();
}
async function admin(table, query = "") {
  const r = await fetch(`${URL_}/rest/v1/${table}?${query}`, { headers: h(SR) });
  return r.json();
}
async function vider() {
  for (const t of ["tirages", "envies", "participants", "foyers", "editions"]) {
    await fetch(`${URL_}/rest/v1/${t}?${t === "tirages" ? "edition_id" : "id"}=not.is.null`, { method: "DELETE", headers: h(SR) });
  }
}

const etat0 = await rpc("admin_etat", { p_mdp: MDP });
assert.equal(etat0.participants.length, 0, "la base contient déjà des participants : scénario refusé");

try {
  const fA = await rpc("admin_foyer_ajouter", { p_mdp: MDP, p_nom: "Foyer A" });
  const fB = await rpc("admin_foyer_ajouter", { p_mdp: MDP, p_nom: "Foyer B" });
  const ids = [];
  for (const [prenom, foyer] of [["A1", fA], ["A2", fA], ["B1", fB], ["B2", fB], ["C", null], ["D", null]]) {
    ids.push(await rpc("admin_participant_ajouter", { p_mdp: MDP, p_prenom: prenom, p_foyer_id: foyer }));
  }
  const ed = await rpc("admin_enregistrer_edition", { p_mdp: MDP, p_annee: 2099, p_budget: "30 €", p_date: "2099-12-24" });

  assert.deepEqual(await lancer(ed, "faux"), { ok: false, raison: "non_autorise" });
  const [r1, r2] = await Promise.all([lancer(ed), lancer(ed)]);
  const oks = [r1, r2].filter((r) => r.ok);
  assert.equal(oks.length, 1, `double lancement : ${JSON.stringify([r1, r2])}`);
  assert.equal(oks[0].nb, 6);

  // Règles vérifiées sans rien imprimer des paires
  const paires = await admin("tirages", `edition_id=eq.${ed}&select=donneur_id,receveur_id`);
  const ps = await admin("participants", "select=id,foyer_id");
  const foyer = new Map(ps.map((p) => [p.id, p.foyer_id]));
  assert.equal(paires.length, 6);
  for (const p of paires) {
    assert.notEqual(p.donneur_id, p.receveur_id);
    assert.ok(foyer.get(p.donneur_id) === null || foyer.get(p.donneur_id) !== foyer.get(p.receveur_id));
  }

  // Page participant
  const liens = await rpc("admin_liens", { p_mdp: MDP });
  const jeton = liens[0].jeton;
  assert.equal((await rpc("mon_tirage", { p_jeton: jeton })).statut, "tire");

  // Code personnel : 8 caractères, retrouve le jeton (minuscules et tiret acceptés), refusé si désactivé
  const code = liens[0].code;
  assert.match(code, /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/);
  assert.equal(await rpc("jeton_par_code", { p_code: `${code.slice(0, 4).toLowerCase()}-${code.slice(4)}` }), jeton);
  assert.equal(new Set(liens.map((l) => l.code)).size, liens.length, "codes uniques");

  // Participant ajouté après tirage → à refaire
  await rpc("admin_participant_ajouter", { p_mdp: MDP, p_prenom: "E", p_foyer_id: null });
  assert.equal((await rpc("admin_etat", { p_mdp: MDP })).tirage_a_refaire, true);
  await rpc("admin_annuler_tirage", { p_mdp: MDP, p_edition_id: ed });
  assert.equal((await rpc("mon_tirage", { p_jeton: jeton })).statut, "pas_tire");

  // Foyer trop grand
  for (const p of ["A3", "A4", "A5", "A6"]) await rpc("admin_participant_ajouter", { p_mdp: MDP, p_prenom: p, p_foyer_id: fA });
  assert.deepEqual(await lancer(ed), { ok: false, raison: "foyer_trop_grand", detail: "Foyer A" });

  // Pas de règle « an dernier » : C et D, seuls participants, se tirent deux années de suite
  for (const p of (await rpc("admin_etat", { p_mdp: MDP })).participants) {
    if (!["C", "D"].includes(p.prenom)) {
      await rpc("admin_participant_modifier", { p_mdp: MDP, p_id: p.id, p_prenom: p.prenom, p_foyer_id: p.foyer_id, p_actif: false });
    }
  }
  const ed2098 = await rpc("admin_enregistrer_edition", { p_mdp: MDP, p_annee: 2098, p_budget: "", p_date: null });
  assert.equal((await lancer(ed2098)).ok, true);
  assert.deepEqual(await lancer(ed), { ok: true, nb: 2 }, "la règle « an dernier » ne doit plus s'appliquer");
  console.log("scenario : OK");
} finally {
  await vider();
}
