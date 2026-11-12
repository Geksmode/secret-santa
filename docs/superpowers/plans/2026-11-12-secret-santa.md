# Secret Santa familial — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Site statique (GitHub Pages) + Supabase permettant à une famille de 10–30 personnes de faire un Secret Santa annuel avec liens personnels, exclusions foyer / an dernier, listes d'envies, en FR/EN.

**Architecture:** Pages HTML/CSS/JS sans framework, servies par GitHub Pages, qui parlent à Supabase via `supabase-js` et la clé publique `anon`. Les tables sont fermées par RLS ; tout passe par des fonctions Postgres `SECURITY DEFINER` (participant : jeton ; admin : mot de passe haché). Le tirage tourne dans une Edge Function qui appelle un module TypeScript pur, testé sous Node.

**Tech Stack:** HTML/CSS/JS (modules ES), `@supabase/supabase-js@2.45.4` via jsDelivr, PostgreSQL (Supabase) + `pgcrypto`, Supabase Edge Functions (Deno), Node 24 (`node --test`, type stripping natif des `.ts`), Supabase CLI via `npx supabase`.

**Spec:** `docs/superpowers/specs/2026-11-12-secret-santa-design.md`

## Global Constraints

- Langues : français + anglais, toutes les chaînes visibles passent par `js/textes.js` (mêmes clés en `fr` et `en`).
- Tests visuels : 1280×800, 820×1180, 375×667, en FR et en EN.
- Aucune fonction ni écran ne renvoie / n'affiche la liste des paires du tirage. Les scripts de vérification n'impriment jamais de paire.
- La clé `service_role` n'apparaît que dans l'Edge Function (variable d'environnement fournie par Supabase) et dans `.env` local (exclu de Git). Jamais dans le site.
- Texte utilisateur toujours inséré avec `textContent` ; liens d'envies acceptés seulement s'ils commencent par `http://` ou `https://`.
- Mise en ligne (push, activation GitHub Pages) uniquement avec l'accord de Thanh Huy.
- Fichiers en CRLF sous Windows : éditer avec l'outil Edit, pas avec des scripts `sed` multi-lignes.
- Textes de l'interface sobres et factuels.
- Écarts assumés vs spec : pas de colonne `envies.ordre` (tri par date de création) ; le tirage utilise un échantillonnage par rejet (uniforme) avec repli sur un appariement aléatoire (voir Task 1) au lieu d'un backtracking.

## Review Focus

1. **Participant ajouté, désactivé ou changé de foyer après le tirage** → la page admin affiche un avertissement « tirage à refaire » et propose l'annulation ; la page participant d'une personne sans tirage affiche « pas encore tiré ». (Task 2 : `admin_etat.tirage_a_refaire` ; Task 5 : test manuel.)
2. **Lien sans jeton, jeton faux ou participant désactivé** → message « lien invalide », jamais d'erreur brute ni de page blanche. (Task 2 : `tests/securite.mjs` ; Task 6.)
3. **Envie contenant du HTML, un texte très long ou un lien `javascript:`** → affichée en texte brut, texte > 500 caractères refusé, lien non-http refusé côté base. (Task 2 : contraintes `check` + test ; Task 6.)
4. **Première édition, ou édition précédente où certains participants étaient absents** → la règle « an dernier » s'applique seulement aux paires qui existent. (Task 1 : tests.)
5. **Double clic sur « Lancer le tirage » / deux onglets admin** → le second appel est refusé (`deja_tire`), aucune paire en double. (Task 2 : `enregistrer_tirage` ; Task 3 : test.)

---

## Structure des fichiers

```
secret-santa/
├─ index.html                 page participant (?t=<jeton>)
├─ admin.html                 page admin
├─ css/style.css              styles communs, responsive
├─ js/config.js               URL Supabase + clé anon (publiques)
├─ js/api.js                  client Supabase + appels RPC / Edge Function
├─ js/textes.js               dictionnaires fr / en
├─ js/i18n.js                 langue courante, t(), traduction du DOM
├─ js/participant.js          logique de index.html
├─ js/admin.js                logique de admin.html
├─ supabase/config.toml       config CLI (verify_jwt=false pour lancer_tirage)
├─ supabase/migrations/20261112000000_schema.sql
├─ supabase/functions/_shared/tirage.ts     algorithme pur
├─ supabase/functions/lancer_tirage/index.ts
├─ tests/tirage.test.ts       tests unitaires de l'algorithme
├─ tests/textes.test.js       parité des clés fr/en
├─ tests/securite.mjs         vérifs RLS / fonctions sur le vrai projet
├─ tests/scenario.mjs         scénario complet sur le vrai projet (données de test)
├─ package.json
└─ .claude/serve.js, .claude/launch.json   aperçu local (exclus de Git)
```

---

### Task 1: Algorithme du tirage

**Files:**
- Create: `package.json`
- Create: `supabase/functions/_shared/tirage.ts`
- Test: `tests/tirage.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces:
  - `type Participant = { id: string; foyer: string | null }`
  - `type Paire = { donneur: string; receveur: string }`
  - `type Resultat = { ok: true; paires: Paire[] } | { ok: false; raison: "trop_peu" | "foyer_trop_grand" | "impossible"; detail?: string }`
  - `function tirer(participants: Participant[], precedent: Map<string, string>, rng?: () => number): Resultat` — `precedent` : donneur → receveur de l'édition précédente. `detail` = id du foyer trop grand.
  - `function estAutorise(d: Participant, r: Participant, precedent: Map<string, string>): boolean`

- [ ] **Step 1: Créer `package.json`**

```json
{
  "name": "secret-santa",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test tests/"
  }
}
```

- [ ] **Step 2: Écrire les tests (qui échouent)**

`tests/tirage.test.ts` :

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { tirer, estAutorise, type Participant, type Paire } from "../supabase/functions/_shared/tirage.ts";

function rngGraine(seed: number): () => number {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function famille(): Participant[] {
  // 12 personnes, foyers de 1 à 4
  const f: [string, string | null][] = [
    ["a1", "A"], ["a2", "A"], ["a3", "A"], ["a4", "A"],
    ["b1", "B"], ["b2", "B"],
    ["c1", "C"], ["c2", "C"], ["c3", "C"],
    ["d1", null], ["e1", null], ["f1", "F"],
  ];
  return f.map(([id, foyer]) => ({ id, foyer }));
}

function verifier(ps: Participant[], paires: Paire[], precedent: Map<string, string>) {
  assert.equal(paires.length, ps.length);
  const parId = new Map(ps.map((p) => [p.id, p]));
  assert.deepEqual(new Set(paires.map((x) => x.donneur)), new Set(ps.map((p) => p.id)));
  assert.deepEqual(new Set(paires.map((x) => x.receveur)), new Set(ps.map((p) => p.id)));
  for (const { donneur, receveur } of paires) {
    assert.ok(estAutorise(parId.get(donneur)!, parId.get(receveur)!, precedent), `${donneur}->${receveur}`);
  }
}

test("estAutorise : soi-même, même foyer, an dernier", () => {
  const prec = new Map([["x", "z"]]);
  const x = { id: "x", foyer: "F" }, y = { id: "y", foyer: "F" }, z = { id: "z", foyer: null }, w = { id: "w", foyer: null };
  assert.equal(estAutorise(x, x, prec), false);
  assert.equal(estAutorise(x, y, prec), false);
  assert.equal(estAutorise(x, z, prec), false);
  assert.equal(estAutorise(x, w, prec), true);
  assert.equal(estAutorise(z, w, prec), true); // foyer null ≠ foyer null
});

test("5000 tirages : règles toujours respectées", () => {
  const ps = famille();
  const rng = rngGraine(42);
  const prec = new Map([["a1", "b1"], ["b1", "c1"], ["d1", "e1"]]);
  for (let i = 0; i < 5000; i++) {
    const r = tirer(ps, prec, rng);
    assert.ok(r.ok);
    if (r.ok) verifier(ps, r.paires, prec);
  }
});

test("première édition : precedent vide", () => {
  const r = tirer(famille(), new Map(), rngGraine(1));
  assert.ok(r.ok);
});

test("precedent avec des absents cette année : ignoré pour eux", () => {
  const prec = new Map([["absent", "a1"], ["a1", "absent2"]]);
  const r = tirer(famille(), prec, rngGraine(2));
  assert.ok(r.ok);
  if (r.ok) verifier(famille(), r.paires, prec);
});

test("moins de 2 participants → trop_peu", () => {
  assert.deepEqual(tirer([], new Map()), { ok: false, raison: "trop_peu" });
  assert.deepEqual(tirer([{ id: "x", foyer: null }], new Map()), { ok: false, raison: "trop_peu" });
});

test("2 participants sans foyer → échange mutuel", () => {
  const r = tirer([{ id: "x", foyer: null }, { id: "y", foyer: null }], new Map(), rngGraine(3));
  assert.ok(r.ok);
});

test("foyer de plus de la moitié → foyer_trop_grand", () => {
  const ps = [
    { id: "a1", foyer: "A" }, { id: "a2", foyer: "A" }, { id: "a3", foyer: "A" },
    { id: "x", foyer: null }, { id: "y", foyer: null },
  ];
  assert.deepEqual(tirer(ps, new Map()), { ok: false, raison: "foyer_trop_grand", detail: "A" });
});

test("2 personnes qui se sont tirées l'an dernier → impossible", () => {
  const ps = [{ id: "x", foyer: null }, { id: "y", foyer: null }];
  const prec = new Map([["x", "y"], ["y", "x"]]);
  assert.deepEqual(tirer(ps, prec, rngGraine(4)), { ok: false, raison: "impossible" });
});

test("cas serré mais possible : solution trouvée", () => {
  // 6 personnes, 3 foyers de 2, an dernier qui ne laisse que peu de solutions
  // (ex. a1->b2, a2->b1, b1->c2, b2->c1, c1->a2, c2->a1)
  const ps = [
    { id: "a1", foyer: "A" }, { id: "a2", foyer: "A" },
    { id: "b1", foyer: "B" }, { id: "b2", foyer: "B" },
    { id: "c1", foyer: "C" }, { id: "c2", foyer: "C" },
  ];
  const prec = new Map([["a1", "b1"], ["a2", "b2"], ["b1", "c1"], ["b2", "c2"], ["c1", "a1"], ["c2", "a2"]]);
  const r = tirer(ps, prec, rngGraine(5));
  assert.ok(r.ok);
  if (r.ok) verifier(ps, r.paires, prec);
});

test("le tirage varie (pas toujours le même résultat)", () => {
  const ps = famille();
  const rng = rngGraine(7);
  const vus = new Set<string>();
  for (let i = 0; i < 50; i++) {
    const r = tirer(ps, new Map(), rng);
    if (r.ok) vus.add(JSON.stringify(r.paires.sort((p, q) => p.donneur.localeCompare(q.donneur))));
  }
  assert.ok(vus.size > 40);
});
```

- [ ] **Step 3: Lancer les tests pour vérifier qu'ils échouent**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../supabase/functions/_shared/tirage.ts'`

- [ ] **Step 4: Écrire l'implémentation**

`supabase/functions/_shared/tirage.ts` :

```ts
// Algorithme pur du tirage Secret Santa. Aucune dépendance : importé par
// l'Edge Function (Deno) et par les tests (Node 24, type stripping).
// N'utiliser que de la syntaxe TS « effaçable » (pas d'enum, pas de namespace).

export type Participant = { id: string; foyer: string | null };
export type Paire = { donneur: string; receveur: string };
export type Resultat =
  | { ok: true; paires: Paire[] }
  | { ok: false; raison: "trop_peu" | "foyer_trop_grand" | "impossible"; detail?: string };

const ESSAIS_PAR_REJET = 5000;

export function estAutorise(d: Participant, r: Participant, precedent: Map<string, string>): boolean {
  if (d.id === r.id) return false;
  if (d.foyer !== null && d.foyer === r.foyer) return false;
  if (precedent.get(d.id) === r.id) return false;
  return true;
}

function melanger<T>(t: T[], rng: () => number): T[] {
  const a = t.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Appariement parfait par chemins augmentants (algorithme de Kuhn), ordre aléatoire.
// Retourne receveurParDonneur (indices) ou null si aucun appariement complet.
function apparier(n: number, autorise: boolean[][], rng: () => number): number[] | null {
  const donneurDuReceveur = new Array<number>(n).fill(-1);
  const voisins = autorise.map((ligne) => melanger(ligne.flatMap((ok, j) => (ok ? [j] : [])), rng));
  const essayer = (d: number, vu: boolean[]): boolean => {
    for (const r of voisins[d]) {
      if (vu[r]) continue;
      vu[r] = true;
      if (donneurDuReceveur[r] === -1 || essayer(donneurDuReceveur[r], vu)) {
        donneurDuReceveur[r] = d;
        return true;
      }
    }
    return false;
  };
  for (const d of melanger([...Array(n).keys()], rng)) {
    if (!essayer(d, new Array<boolean>(n).fill(false))) return null;
  }
  const res = new Array<number>(n);
  donneurDuReceveur.forEach((d, r) => (res[d] = r));
  return res;
}

export function tirer(
  participants: Participant[],
  precedent: Map<string, string>,
  rng: () => number = Math.random,
): Resultat {
  const n = participants.length;
  if (n < 2) return { ok: false, raison: "trop_peu" };

  const tailles = new Map<string, number>();
  for (const p of participants) if (p.foyer !== null) tailles.set(p.foyer, (tailles.get(p.foyer) ?? 0) + 1);
  for (const [foyer, k] of tailles) if (k > n - k) return { ok: false, raison: "foyer_trop_grand", detail: foyer };

  const autorise = participants.map((d) => participants.map((r) => estAutorise(d, r, precedent)));
  const enPaires = (rec: number[]): Resultat => ({
    ok: true,
    paires: rec.map((r, d) => ({ donneur: participants[d].id, receveur: participants[r].id })),
  });

  // 1) Échantillonnage par rejet : uniforme parmi les tirages valides.
  const indices = [...Array(n).keys()];
  for (let e = 0; e < ESSAIS_PAR_REJET; e++) {
    const perm = melanger(indices, rng);
    if (perm.every((r, d) => autorise[d][r])) return enPaires(perm);
  }
  // 2) Repli : appariement aléatoire (pas parfaitement uniforme), exact pour détecter l'impossible.
  const rec = apparier(n, autorise, rng);
  return rec ? enPaires(rec) : { ok: false, raison: "impossible" };
}
```

- [ ] **Step 5: Lancer les tests**

Run: `npm test`
Expected: PASS, 9 tests.

- [ ] **Step 6: Aperçu local et commit**

Créer `.claude/serve.js` (copie de `C:\Users\Geksmode\Documents\Projets\Linh-Huy-Wedding\.claude\serve.js`) et `.claude/launch.json` :

```json
{"version":"0.0.1","configurations":[{"name":"secret-santa","runtimeExecutable":"node","runtimeArgs":[".claude/serve.js",".","5174"],"port":5174}]}
```

```bash
git add package.json supabase/functions/_shared/tirage.ts tests/tirage.test.ts
git commit -m "feat: algorithme du tirage avec exclusions foyer et an dernier"
```

---

### Task 2: Base Supabase (schéma, RLS, fonctions)

**Files:**
- Create: `supabase/config.toml` (via `npx supabase init`)
- Create: `supabase/migrations/20261112000000_schema.sql`
- Create: `.env.example`
- Test: `tests/securite.mjs`

**Interfaces:**
- Consumes: rien.
- Produces (fonctions RPC appelables avec la clé anon ; tous les paramètres préfixés `p_`) :
  - `moi(p_jeton text) → json | null` : `{prenom, edition: {id, annee, budget, date_echange, tiree} | null}`
  - `mon_tirage(p_jeton text) → json | null` : `{statut: "pas_tire"}` ou `{statut: "tire", receveur: text, envies: [{texte, lien}]}`
  - `mes_envies(p_jeton text) → json` : `[{id, texte, lien}]`
  - `ajouter_envie(p_jeton text, p_texte text, p_lien text) → uuid`
  - `modifier_envie(p_jeton text, p_id uuid, p_texte text, p_lien text) → void`
  - `supprimer_envie(p_jeton text, p_id uuid) → void`
  - `verifier_admin(p_mdp text) → boolean`
  - `admin_etat(p_mdp text) → json` : `{foyers:[{id,nom}], participants:[{id,prenom,foyer_id,actif}], edition:{id,annee,budget,date_echange,tiree}|null, tirage_a_refaire:boolean}`
  - `admin_foyer_ajouter(p_mdp, p_nom) → uuid`, `admin_foyer_renommer(p_mdp, p_id, p_nom)`, `admin_foyer_supprimer(p_mdp, p_id)`
  - `admin_participant_ajouter(p_mdp, p_prenom, p_foyer_id uuid) → uuid`, `admin_participant_modifier(p_mdp, p_id, p_prenom, p_foyer_id, p_actif)`
  - `admin_liens(p_mdp) → json` : `[{prenom, jeton}]` (participants actifs)
  - `admin_enregistrer_edition(p_mdp, p_annee int, p_budget text, p_date date) → uuid` (crée ou met à jour par année)
  - `admin_annuler_tirage(p_mdp, p_edition_id uuid)`
  - Réservée `service_role` : `enregistrer_tirage(p_edition_id uuid, p_paires jsonb) → void` — lève `deja_tire` si l'édition est déjà tirée.
- Erreurs : les fonctions admin lèvent `exception 'non_autorise'` si mot de passe faux ; les fonctions participant renvoient `null` / ne font rien si jeton inconnu ou participant inactif.

- [ ] **Step 1 (Thanh Huy) : créer le projet Supabase**

Sur supabase.com : nouveau projet `secret-santa`, région Europe (Paris ou Francfort). Noter l'URL du projet et la clé `anon` / publishable (Settings → API). Puis, dans un terminal du repo :

```bash
npx supabase login
```

```bash
npx supabase init
```

```bash
npx supabase link --project-ref <ref-du-projet>
```

Créer `.env` (exclu de Git) à partir de `.env.example` :

```
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_ANON_KEY=<clé anon>
SUPABASE_SERVICE_ROLE_KEY=<clé service_role>
ADMIN_MDP_TEST=<mot de passe admin de test>
```

- [ ] **Step 2: Écrire le test de sécurité (qui échoue tant que la migration n'est pas appliquée)**

`tests/securite.mjs` (lancé avec `node --env-file=.env tests/securite.mjs`) :

```js
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
```

Run: `node --env-file=.env tests/securite.mjs`
Expected: FAIL (fonctions inexistantes → 404).

- [ ] **Step 3: Écrire la migration**

`supabase/migrations/20261112000000_schema.sql` :

```sql
create extension if not exists pgcrypto with schema extensions;

-- ---------- Tables ----------
create table public.foyers (
  id uuid primary key default gen_random_uuid(),
  nom text not null check (length(trim(nom)) between 1 and 80)
);

create table public.participants (
  id uuid primary key default gen_random_uuid(),
  prenom text not null check (length(trim(prenom)) between 1 and 80),
  foyer_id uuid references public.foyers(id) on delete set null,
  actif boolean not null default true,
  jeton text not null unique default encode(extensions.gen_random_bytes(18), 'hex')
);

create table public.editions (
  id uuid primary key default gen_random_uuid(),
  annee int not null unique check (annee between 2000 and 2100),
  budget text not null default '' check (length(budget) <= 40),
  date_echange date,
  tiree boolean not null default false
);

create table public.tirages (
  edition_id uuid not null references public.editions(id) on delete cascade,
  donneur_id uuid not null references public.participants(id) on delete cascade,
  receveur_id uuid not null references public.participants(id) on delete cascade,
  primary key (edition_id, donneur_id),
  unique (edition_id, receveur_id),
  check (donneur_id <> receveur_id)
);

create table public.envies (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  texte text not null check (length(trim(texte)) between 1 and 500),
  lien text check (lien is null or (lien ~* '^https?://' and length(lien) <= 1000)),
  cree_le timestamptz not null default now()
);

create table public.config (
  id int primary key default 1 check (id = 1),
  admin_hash text not null
);

-- ---------- Fermeture totale des tables ----------
alter table public.foyers enable row level security;
alter table public.participants enable row level security;
alter table public.editions enable row level security;
alter table public.tirages enable row level security;
alter table public.envies enable row level security;
alter table public.config enable row level security;
revoke all on all tables in schema public from anon, authenticated;

-- ---------- Outils internes ----------
create function public._participant(p_jeton text) returns public.participants
language sql stable security definer set search_path = public as $$
  select * from public.participants where jeton = p_jeton and actif limit 1;
$$;

create function public._edition_courante() returns public.editions
language sql stable security definer set search_path = public as $$
  select * from public.editions order by annee desc limit 1;
$$;

create function public._exiger_admin(p_mdp text) returns void
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if not exists (select 1 from public.config where admin_hash = extensions.crypt(p_mdp, admin_hash)) then
    raise exception 'non_autorise';
  end if;
end $$;

create function public._lien_valide(p_lien text) returns text
language sql immutable as $$
  select nullif(trim(p_lien), '');
$$;

revoke execute on function public._participant(text), public._edition_courante(),
  public._exiger_admin(text), public._lien_valide(text) from public, anon, authenticated;

-- ---------- Participant ----------
create function public.moi(p_jeton text) returns json
language plpgsql stable security definer set search_path = public as $$
declare p public.participants; e public.editions;
begin
  p := public._participant(p_jeton);
  if p.id is null then return null; end if;
  e := public._edition_courante();
  return json_build_object(
    'prenom', p.prenom,
    'edition', case when e.id is null then null else json_build_object(
      'id', e.id, 'annee', e.annee, 'budget', e.budget, 'date_echange', e.date_echange, 'tiree', e.tiree) end);
end $$;

create function public.mon_tirage(p_jeton text) returns json
language plpgsql stable security definer set search_path = public as $$
declare p public.participants; e public.editions; r public.participants;
begin
  p := public._participant(p_jeton);
  if p.id is null then return null; end if;
  e := public._edition_courante();
  select pr.* into r from public.tirages t join public.participants pr on pr.id = t.receveur_id
    where t.edition_id = e.id and t.donneur_id = p.id;
  if r.id is null then return json_build_object('statut', 'pas_tire'); end if;
  return json_build_object('statut', 'tire', 'receveur', r.prenom, 'envies',
    coalesce((select json_agg(json_build_object('texte', v.texte, 'lien', v.lien) order by v.cree_le)
              from public.envies v where v.participant_id = r.id), '[]'::json));
end $$;

create function public.mes_envies(p_jeton text) returns json
language plpgsql stable security definer set search_path = public as $$
declare p public.participants;
begin
  p := public._participant(p_jeton);
  if p.id is null then return null; end if;
  return coalesce((select json_agg(json_build_object('id', v.id, 'texte', v.texte, 'lien', v.lien) order by v.cree_le)
                   from public.envies v where v.participant_id = p.id), '[]'::json);
end $$;

create function public.ajouter_envie(p_jeton text, p_texte text, p_lien text) returns uuid
language plpgsql security definer set search_path = public as $$
declare p public.participants; nid uuid;
begin
  p := public._participant(p_jeton);
  if p.id is null then return null; end if;
  if (select count(*) from public.envies where participant_id = p.id) >= 30 then raise exception 'trop_d_envies'; end if;
  insert into public.envies (participant_id, texte, lien)
    values (p.id, trim(p_texte), public._lien_valide(p_lien)) returning id into nid;
  return nid;
end $$;

create function public.modifier_envie(p_jeton text, p_id uuid, p_texte text, p_lien text) returns void
language plpgsql security definer set search_path = public as $$
declare p public.participants;
begin
  p := public._participant(p_jeton);
  if p.id is null then return; end if;
  update public.envies set texte = trim(p_texte), lien = public._lien_valide(p_lien)
    where id = p_id and participant_id = p.id;
end $$;

create function public.supprimer_envie(p_jeton text, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p public.participants;
begin
  p := public._participant(p_jeton);
  if p.id is null then return; end if;
  delete from public.envies where id = p_id and participant_id = p.id;
end $$;

-- ---------- Admin ----------
create function public.verifier_admin(p_mdp text) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from public.config where admin_hash = extensions.crypt(p_mdp, admin_hash));
$$;

create function public.admin_etat(p_mdp text) returns json
language plpgsql stable security definer set search_path = public as $$
declare e public.editions; a_refaire boolean := false;
begin
  perform public._exiger_admin(p_mdp);
  e := public._edition_courante();
  if e.tiree then
    -- actifs sans tirage, tirés mais inactifs, ou paire devenue interdite (même foyer)
    a_refaire :=
      exists (select 1 from public.participants p where p.actif
              and not exists (select 1 from public.tirages t where t.edition_id = e.id and t.donneur_id = p.id))
      or exists (select 1 from public.tirages t join public.participants p on p.id in (t.donneur_id, t.receveur_id)
                 where t.edition_id = e.id and not p.actif)
      or exists (select 1 from public.tirages t
                 join public.participants d on d.id = t.donneur_id
                 join public.participants r on r.id = t.receveur_id
                 where t.edition_id = e.id and d.foyer_id is not null and d.foyer_id = r.foyer_id);
  end if;
  return json_build_object(
    'foyers', coalesce((select json_agg(json_build_object('id', id, 'nom', nom) order by nom) from public.foyers), '[]'::json),
    'participants', coalesce((select json_agg(json_build_object('id', id, 'prenom', prenom, 'foyer_id', foyer_id, 'actif', actif) order by prenom) from public.participants), '[]'::json),
    'edition', case when e.id is null then null else json_build_object(
      'id', e.id, 'annee', e.annee, 'budget', e.budget, 'date_echange', e.date_echange, 'tiree', e.tiree) end,
    'tirage_a_refaire', a_refaire);
end $$;

create function public.admin_foyer_ajouter(p_mdp text, p_nom text) returns uuid
language plpgsql security definer set search_path = public as $$
declare nid uuid;
begin
  perform public._exiger_admin(p_mdp);
  insert into public.foyers (nom) values (trim(p_nom)) returning id into nid;
  return nid;
end $$;

create function public.admin_foyer_renommer(p_mdp text, p_id uuid, p_nom text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._exiger_admin(p_mdp);
  update public.foyers set nom = trim(p_nom) where id = p_id;
end $$;

create function public.admin_foyer_supprimer(p_mdp text, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._exiger_admin(p_mdp);
  delete from public.foyers where id = p_id;
end $$;

create function public.admin_participant_ajouter(p_mdp text, p_prenom text, p_foyer_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare nid uuid;
begin
  perform public._exiger_admin(p_mdp);
  insert into public.participants (prenom, foyer_id) values (trim(p_prenom), p_foyer_id) returning id into nid;
  return nid;
end $$;

create function public.admin_participant_modifier(p_mdp text, p_id uuid, p_prenom text, p_foyer_id uuid, p_actif boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._exiger_admin(p_mdp);
  update public.participants set prenom = trim(p_prenom), foyer_id = p_foyer_id, actif = p_actif where id = p_id;
end $$;

create function public.admin_liens(p_mdp text) returns json
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._exiger_admin(p_mdp);
  return coalesce((select json_agg(json_build_object('prenom', prenom, 'jeton', jeton) order by prenom)
                   from public.participants where actif), '[]'::json);
end $$;

create function public.admin_enregistrer_edition(p_mdp text, p_annee int, p_budget text, p_date date) returns uuid
language plpgsql security definer set search_path = public as $$
declare nid uuid;
begin
  perform public._exiger_admin(p_mdp);
  insert into public.editions (annee, budget, date_echange) values (p_annee, coalesce(trim(p_budget), ''), p_date)
    on conflict (annee) do update set budget = excluded.budget, date_echange = excluded.date_echange
    returning id into nid;
  return nid;
end $$;

create function public.admin_annuler_tirage(p_mdp text, p_edition_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._exiger_admin(p_mdp);
  delete from public.tirages where edition_id = p_edition_id;
  update public.editions set tiree = false where id = p_edition_id;
end $$;

-- ---------- Réservé à l'Edge Function (service_role) ----------
create function public.enregistrer_tirage(p_edition_id uuid, p_paires jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  -- verrou de ligne : deux appels simultanés sont sérialisés
  if (select tiree from public.editions where id = p_edition_id for update) then
    raise exception 'deja_tire';
  end if;
  insert into public.tirages (edition_id, donneur_id, receveur_id)
    select p_edition_id, (x->>'donneur')::uuid, (x->>'receveur')::uuid from jsonb_array_elements(p_paires) x;
  update public.editions set tiree = true where id = p_edition_id;
end $$;

-- ---------- Droits d'exécution ----------
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.moi(text), public.mon_tirage(text), public.mes_envies(text),
  public.ajouter_envie(text, text, text), public.modifier_envie(text, uuid, text, text), public.supprimer_envie(text, uuid),
  public.verifier_admin(text), public.admin_etat(text),
  public.admin_foyer_ajouter(text, text), public.admin_foyer_renommer(text, uuid, text), public.admin_foyer_supprimer(text, uuid),
  public.admin_participant_ajouter(text, text, uuid), public.admin_participant_modifier(text, uuid, text, uuid, boolean),
  public.admin_liens(text), public.admin_enregistrer_edition(text, int, text, date), public.admin_annuler_tirage(text, uuid)
  to anon;
grant execute on function public.enregistrer_tirage(uuid, jsonb), public.verifier_admin(text) to service_role;
```

Note : `ajouter_envie` avec un lien `javascript:` sur un jeton valide lève une erreur de contrainte `check` → le front affiche « lien invalide ».

- [ ] **Step 4: Appliquer la migration**

Run: `npx supabase db push`
Expected: `Applying migration 20261112000000_schema.sql... Finished`.

- [ ] **Step 5 (Thanh Huy) : définir le mot de passe admin**

Dans Supabase → SQL Editor, en remplaçant le mot de passe :

```sql
insert into public.config (id, admin_hash)
values (1, extensions.crypt('MOT_DE_PASSE_CHOISI', extensions.gen_salt('bf')))
on conflict (id) do update set admin_hash = excluded.admin_hash;
```

Pour la phase de dev, utiliser le mot de passe de test de `.env` (`ADMIN_MDP_TEST`) ; le remplacer par le vrai avant la mise en service (Task 7).

- [ ] **Step 6: Lancer le test de sécurité**

Run: `node --env-file=.env tests/securite.mjs`
Expected: `securite : OK`

- [ ] **Step 7: Commit**

`.env.example` contient les 4 clés de `.env` sans valeurs.

```bash
git add supabase/config.toml supabase/migrations tests/securite.mjs .env.example
git commit -m "feat: schéma Supabase, RLS et fonctions participant/admin"
```

---

### Task 3: Edge Function `lancer_tirage`

**Files:**
- Create: `supabase/functions/lancer_tirage/index.ts`
- Modify: `supabase/config.toml` (section de la fonction)
- Test: `tests/scenario.mjs`

**Interfaces:**
- Consumes: `tirer`, `Participant` (Task 1) ; `verifier_admin`, `enregistrer_tirage`, tables (Task 2).
- Produces: `POST {SUPABASE_URL}/functions/v1/lancer_tirage`, corps `{"mot_de_passe": string, "edition_id": string}` → `200 {"ok": true, "nb": number}` ou `200 {"ok": false, "raison": "non_autorise" | "deja_tire" | "trop_peu" | "foyer_trop_grand" | "impossible" | "edition_inconnue", "detail"?: string}` (`detail` = **nom** du foyer trop grand).

- [ ] **Step 1: Écrire le scénario (qui échoue)**

`tests/scenario.mjs` — utilise des données de test et **efface tout** à la fin. Ne jamais le lancer une fois la vraie famille saisie (le script refuse si des participants existent déjà).

```js
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

  // Participant ajouté après tirage → à refaire
  await rpc("admin_participant_ajouter", { p_mdp: MDP, p_prenom: "E", p_foyer_id: null });
  assert.equal((await rpc("admin_etat", { p_mdp: MDP })).tirage_a_refaire, true);
  await rpc("admin_annuler_tirage", { p_mdp: MDP, p_edition_id: ed });
  assert.equal((await rpc("mon_tirage", { p_jeton: jeton })).statut, "pas_tire");

  // Foyer trop grand
  for (const p of ["A3", "A4", "A5"]) await rpc("admin_participant_ajouter", { p_mdp: MDP, p_prenom: p, p_foyer_id: fA });
  assert.deepEqual(await lancer(ed), { ok: false, raison: "foyer_trop_grand", detail: "Foyer A" });
  console.log("scenario : OK");
} finally {
  await vider();
}
```

Run: `node --env-file=.env tests/scenario.mjs`
Expected: FAIL — la fonction `lancer_tirage` n'existe pas (404, `r.json()` échoue).

- [ ] **Step 2: Écrire l'Edge Function**

`supabase/functions/lancer_tirage/index.ts` :

```ts
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

  const precedent = new Map<string, string>();
  const { data: avant } = await db.from("editions").select("id").lt("annee", ed.annee).order("annee", { ascending: false }).limit(1).maybeSingle();
  if (avant) {
    const { data: tp } = await db.from("tirages").select("donneur_id, receveur_id").eq("edition_id", avant.id);
    for (const t of tp ?? []) precedent.set(t.donneur_id, t.receveur_id);
  }

  const res = tirer(participants, precedent, () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296);
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
```

Ajouter à `supabase/config.toml` (le mot de passe est vérifié dans la fonction ; la clé publishable n'est pas forcément un JWT) :

```toml
[functions.lancer_tirage]
verify_jwt = false
```

- [ ] **Step 3: Déployer**

Run: `npx supabase functions deploy lancer_tirage --no-verify-jwt`
Expected: `Deployed Functions on project <ref>: lancer_tirage`.

- [ ] **Step 4: Lancer le scénario**

Run: `node --env-file=.env tests/scenario.mjs`
Expected: `scenario : OK` (la base est vidée à la fin).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/lancer_tirage supabase/config.toml tests/scenario.mjs
git commit -m "feat: Edge Function lancer_tirage"
```

---

### Task 4: Socle front (config, API, traductions, styles)

**Files:**
- Create: `js/config.js`, `js/api.js`, `js/textes.js`, `js/i18n.js`, `css/style.css`
- Test: `tests/textes.test.js`

**Interfaces:**
- Consumes: fonctions RPC (Task 2), Edge Function (Task 3).
- Produces:
  - `js/config.js` : `export const SUPABASE_URL`, `export const SUPABASE_ANON_KEY`
  - `js/api.js` : `export async function appel(nom: string, args: object): Promise<any>` (lève `Error(code)` où `code` ∈ `non_autorise | trop_d_envies | lien_invalide | texte_invalide | reseau | erreur`) ; `export async function lancerTirage(mdp, editionId): Promise<{ok, nb?, raison?, detail?}>`
  - `js/i18n.js` : `export function langue(): "fr"|"en"`, `export function changerLangue(l)`, `export function t(cle: string, vars?: object): string`, `export function traduire(racine = document)` (remplit `[data-i18n]` en `textContent` et `[data-i18n-placeholder]`), `export function brancherSelecteur(el: HTMLSelectElement, apres: () => void)`, `export function formaterDate(iso: string): string` (ex. « 24 décembre 2026 » / « 24 December 2026 »)
  - `js/textes.js` : `export const TEXTES = { fr: {...}, en: {...} }`
  - Classes CSS : `.page`, `.carte`, `.ligne`, `.bouton`, `.bouton.secondaire`, `.bouton.danger`, `.alerte`, `.alerte.info`, `.liste`, `.muet`, `.entete`

- [ ] **Step 1: Test de parité des traductions (qui échoue)**

`tests/textes.test.js` :

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { TEXTES } from "../js/textes.js";

test("fr et en ont exactement les mêmes clés, toutes non vides", () => {
  assert.deepEqual(Object.keys(TEXTES.fr).sort(), Object.keys(TEXTES.en).sort());
  for (const l of ["fr", "en"]) for (const [k, v] of Object.entries(TEXTES[l])) assert.ok(v.trim(), `${l}.${k} vide`);
});

test("mêmes variables {x} dans fr et en", () => {
  const vars = (s) => (s.match(/\{\w+\}/g) ?? []).sort().join();
  for (const k of Object.keys(TEXTES.fr)) assert.equal(vars(TEXTES.fr[k]), vars(TEXTES.en[k]), k);
});
```

Run: `npm test` → Expected: FAIL (`js/textes.js` introuvable).

- [ ] **Step 2: Écrire `js/textes.js`**

```js
export const TEXTES = {
  fr: {
    titre: "Secret Santa",
    langue: "Langue",
    chargement: "Chargement…",
    erreur_reseau: "Impossible de joindre le serveur. Réessaie plus tard.",
    erreur_generique: "Une erreur est survenue. Réessaie plus tard.",
    // participant
    lien_invalide: "Lien invalide. Demande ton lien à l'organisateur.",
    bonjour: "Bonjour {prenom}",
    pas_d_edition: "Aucun Secret Santa n'est organisé pour le moment.",
    pas_tire: "Le tirage n'a pas encore eu lieu. Reviens plus tard sur ce même lien.",
    tu_offres: "Tu offres un cadeau à",
    budget: "Budget : {budget}",
    date: "Échange des cadeaux : {date}",
    envies_de: "Les envies de {prenom}",
    aucune_envie_receveur: "{prenom} n'a pas encore noté d'envies.",
    mes_envies: "Ma liste d'envies",
    mes_envies_aide: "Ton Secret Santa verra cette liste.",
    aucune_envie: "Ta liste est vide.",
    envie_texte: "Idée de cadeau",
    envie_lien: "Lien (facultatif)",
    ajouter: "Ajouter",
    modifier: "Modifier",
    enregistrer: "Enregistrer",
    annuler: "Annuler",
    supprimer: "Supprimer",
    confirmer_suppression: "Supprimer cette envie ?",
    erreur_texte: "L'idée doit faire entre 1 et 500 caractères.",
    erreur_lien: "Le lien doit commencer par http:// ou https://.",
    erreur_trop_d_envies: "30 envies maximum.",
    // admin
    admin_titre: "Administration",
    mot_de_passe: "Mot de passe",
    se_connecter: "Se connecter",
    se_deconnecter: "Se déconnecter",
    mdp_faux: "Mot de passe incorrect.",
    foyers: "Foyers",
    foyers_aide: "Les membres d'un même foyer ne peuvent pas se tirer entre eux.",
    nom_foyer: "Nom du foyer",
    participants: "Participants",
    prenom: "Prénom",
    foyer: "Foyer",
    sans_foyer: "Aucun",
    actif: "Participe",
    edition: "Édition",
    annee: "Année",
    date_echange: "Date d'échange",
    lancer_tirage: "Lancer le tirage",
    annuler_tirage: "Annuler le tirage",
    confirmer_annulation: "Annuler le tirage ? Chacun recevra une nouvelle personne au prochain tirage.",
    tirage_fait: "Tirage effectué ({nb} participants). Personne, toi compris, ne peut voir le résultat complet.",
    tirage_deja_fait: "Le tirage de cette édition est fait.",
    tirage_a_refaire: "La liste des participants ou des foyers a changé depuis le tirage. Annule puis relance le tirage.",
    raison_trop_peu: "Il faut au moins 2 participants.",
    raison_foyer_trop_grand: "Aucun tirage possible : le foyer « {foyer} » regroupe plus de la moitié des participants.",
    raison_impossible: "Aucun tirage possible avec ces règles (foyers et tirage de l'an dernier).",
    raison_deja_tire: "Le tirage a déjà été fait.",
    raison_edition_inconnue: "Édition introuvable. Enregistre d'abord l'édition.",
    liens: "Liens personnels",
    liens_aide: "Envoie à chacun son lien (WhatsApp, SMS). Le lien reste le même chaque année.",
    copier: "Copier le lien",
    copie: "Copié",
  },
  en: {
    titre: "Secret Santa",
    langue: "Language",
    chargement: "Loading…",
    erreur_reseau: "Can't reach the server. Please try again later.",
    erreur_generique: "Something went wrong. Please try again later.",
    lien_invalide: "Invalid link. Ask the organiser for your link.",
    bonjour: "Hi {prenom}",
    pas_d_edition: "No Secret Santa is organised at the moment.",
    pas_tire: "The draw hasn't happened yet. Come back later using this same link.",
    tu_offres: "You're giving a gift to",
    budget: "Budget: {budget}",
    date: "Gift exchange: {date}",
    envies_de: "{prenom}'s wish list",
    aucune_envie_receveur: "{prenom} hasn't added any wishes yet.",
    mes_envies: "My wish list",
    mes_envies_aide: "Your Secret Santa will see this list.",
    aucune_envie: "Your list is empty.",
    envie_texte: "Gift idea",
    envie_lien: "Link (optional)",
    ajouter: "Add",
    modifier: "Edit",
    enregistrer: "Save",
    annuler: "Cancel",
    supprimer: "Delete",
    confirmer_suppression: "Delete this wish?",
    erreur_texte: "The idea must be 1 to 500 characters long.",
    erreur_lien: "The link must start with http:// or https://.",
    erreur_trop_d_envies: "30 wishes maximum.",
    admin_titre: "Administration",
    mot_de_passe: "Password",
    se_connecter: "Sign in",
    se_deconnecter: "Sign out",
    mdp_faux: "Wrong password.",
    foyers: "Households",
    foyers_aide: "Members of the same household can't draw each other.",
    nom_foyer: "Household name",
    participants: "Participants",
    prenom: "First name",
    foyer: "Household",
    sans_foyer: "None",
    actif: "Taking part",
    edition: "Edition",
    annee: "Year",
    date_echange: "Exchange date",
    lancer_tirage: "Run the draw",
    annuler_tirage: "Cancel the draw",
    confirmer_annulation: "Cancel the draw? Everyone will get a new person at the next draw.",
    tirage_fait: "Draw done ({nb} participants). Nobody, including you, can see the full result.",
    tirage_deja_fait: "The draw for this edition is done.",
    tirage_a_refaire: "Participants or households changed since the draw. Cancel and run the draw again.",
    raison_trop_peu: "At least 2 participants are needed.",
    raison_foyer_trop_grand: "No draw possible: household \"{foyer}\" has more than half of the participants.",
    raison_impossible: "No draw possible with these rules (households and last year's draw).",
    raison_deja_tire: "The draw has already been done.",
    raison_edition_inconnue: "Edition not found. Save the edition first.",
    liens: "Personal links",
    liens_aide: "Send each person their link (WhatsApp, text). The link stays the same every year.",
    copier: "Copy link",
    copie: "Copied",
  },
};
```

- [ ] **Step 3: Écrire `js/i18n.js`**

```js
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
```
- [ ] **Step 4: Écrire `js/config.js` et `js/api.js`**

`js/config.js` (valeurs publiques fournies par Thanh Huy, Task 2 Step 1) :

```js
export const SUPABASE_URL = "https://<ref>.supabase.co";
export const SUPABASE_ANON_KEY = "<clé anon publique>";
```

`js/api.js` :

```js
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
```

- [ ] **Step 5: Écrire `css/style.css`**

```css
:root {
  --fond: #f7f3ee; --carte: #ffffff; --texte: #2b2622; --muet: #6f665e;
  --accent: #b3261e; --accent-texte: #ffffff; --bord: #e4dcd2; --info: #eef4f0; --alerte: #fdecea;
  --rayon: 12px; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root { --fond: #1c1a18; --carte: #262321; --texte: #f1ece6; --muet: #a89f96; --bord: #3a3531;
          --accent: #e0574e; --info: #22302a; --alerte: #3a2220; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--fond); color: var(--texte); line-height: 1.5; }
.page { max-width: 760px; margin: 0 auto; padding: 16px 16px 48px; }
.entete { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
.entete h1 { margin: 0; font-size: 1.5rem; }
.carte { background: var(--carte); border: 1px solid var(--bord); border-radius: var(--rayon); padding: 16px; margin-bottom: 16px; }
.carte h2 { margin: 0 0 8px; font-size: 1.15rem; }
.ligne { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.ligne > input, .ligne > select { flex: 1 1 160px; min-width: 0; }
input, select { font: inherit; padding: 8px 10px; border: 1px solid var(--bord); border-radius: 8px; background: var(--carte); color: var(--texte); }
.bouton { font: inherit; padding: 8px 14px; border-radius: 8px; border: 1px solid var(--accent); background: var(--accent); color: var(--accent-texte); cursor: pointer; }
.bouton.secondaire { background: transparent; color: var(--accent); }
.bouton.danger { background: transparent; color: var(--accent); border-color: var(--bord); }
.bouton:disabled { opacity: .5; cursor: default; }
.alerte { padding: 10px 12px; border-radius: 8px; background: var(--alerte); margin: 8px 0; }
.alerte.info { background: var(--info); }
.liste { list-style: none; margin: 0; padding: 0; }
.liste > li { padding: 10px 0; border-top: 1px solid var(--bord); overflow-wrap: anywhere; }
.liste > li:first-child { border-top: 0; }
.muet { color: var(--muet); font-size: .95rem; }
.receveur { font-size: 2rem; font-weight: 700; margin: 4px 0 8px; overflow-wrap: anywhere; }
[hidden] { display: none !important; }
```

- [ ] **Step 6: Tests**

Run: `npm test`
Expected: PASS (tests `tirage` + `textes`).

- [ ] **Step 7: Commit**

```bash
git add js css tests/textes.test.js
git commit -m "feat: socle front (API Supabase, traductions FR/EN, styles)"
```

---

### Task 5: Page admin

**Files:**
- Create: `admin.html`, `js/admin.js`

**Interfaces:**
- Consumes: `appel`, `lancerTirage` (Task 4, `js/api.js`) ; `t`, `traduire`, `brancherSelecteur`, `formaterDate` (Task 4, `js/i18n.js`) ; RPC admin (Task 2).
- Produces: page `admin.html`. Mot de passe gardé dans `sessionStorage["ss-mdp"]`.

- [ ] **Step 1: Écrire `admin.html`**

```html
<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Secret Santa</title>
  <link rel="stylesheet" href="css/style.css">
</head>
<body>
  <main class="page">
    <header class="entete">
      <h1 data-i18n="admin_titre"></h1>
      <div class="ligne">
        <select id="langue" aria-label="Langue"><option value="fr">FR</option><option value="en">EN</option></select>
        <button id="deconnexion" class="bouton secondaire" data-i18n="se_deconnecter" hidden></button>
      </div>
    </header>

    <div id="message" class="alerte" hidden></div>

    <section id="connexion" class="carte">
      <form id="form-connexion" class="ligne">
        <input id="mdp" type="password" autocomplete="current-password" data-i18n-placeholder="mot_de_passe" required>
        <button class="bouton" data-i18n="se_connecter"></button>
      </form>
    </section>

    <div id="contenu" hidden>
      <section class="carte">
        <h2 data-i18n="edition"></h2>
        <form id="form-edition" class="ligne">
          <input id="annee" type="number" min="2000" max="2100" data-i18n-placeholder="annee" required>
          <input id="budget" maxlength="40" data-i18n-placeholder="budget">
          <input id="date" type="date" aria-label="date">
          <button class="bouton secondaire" data-i18n="enregistrer"></button>
        </form>
        <p id="etat-tirage" class="muet"></p>
        <div id="a-refaire" class="alerte" data-i18n="tirage_a_refaire" hidden></div>
        <div class="ligne">
          <button id="lancer" class="bouton" data-i18n="lancer_tirage"></button>
          <button id="annuler" class="bouton danger" data-i18n="annuler_tirage"></button>
        </div>
      </section>

      <section class="carte">
        <h2 data-i18n="foyers"></h2>
        <p class="muet" data-i18n="foyers_aide"></p>
        <ul id="liste-foyers" class="liste"></ul>
        <form id="form-foyer" class="ligne">
          <input id="nom-foyer" maxlength="80" data-i18n-placeholder="nom_foyer" required>
          <button class="bouton secondaire" data-i18n="ajouter"></button>
        </form>
      </section>

      <section class="carte">
        <h2 data-i18n="participants"></h2>
        <ul id="liste-participants" class="liste"></ul>
        <form id="form-participant" class="ligne">
          <input id="prenom" maxlength="80" data-i18n-placeholder="prenom" required>
          <select id="foyer-participant"></select>
          <button class="bouton secondaire" data-i18n="ajouter"></button>
        </form>
      </section>

      <section class="carte">
        <h2 data-i18n="liens"></h2>
        <p class="muet" data-i18n="liens_aide"></p>
        <ul id="liste-liens" class="liste"></ul>
      </section>
    </div>
  </main>
  <script type="module" src="js/admin.js"></script>
</body>
</html>
```

- [ ] **Step 2: Écrire `js/admin.js`**

```js
import { appel, lancerTirage } from "./api.js";
import { t, traduire, brancherSelecteur } from "./i18n.js";

const $ = (id) => document.getElementById(id);
const RAISONS_CONNUES = new Set(["trop_peu", "foyer_trop_grand", "impossible", "deja_tire", "edition_inconnue"]);
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
  $("etat-tirage").textContent = ed?.tiree ? t("tirage_deja_fait") : "";
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
    return el("li", {}, [el("div", { className: "ligne" }, [el("span", { textContent: l.prenom, style: "flex:1" }), b])]);
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
  if (r.ok) message(t("tirage_fait", { nb: r.nb }), true);
  else if (r.raison === "non_autorise") { deconnecter(); message(t("mdp_faux")); return; }
  else if (r.raison === "reseau") message(t("erreur_reseau"));
  else message(RAISONS_CONNUES.has(r.raison) ? t(`raison_${r.raison}`, { foyer: r.detail ?? "" }) : t("erreur_generique"));
  charger();
};
$("annuler").onclick = () => { if (confirm(t("confirmer_annulation"))) action("admin_annuler_tirage", { p_edition_id: etat.edition.id }); };

brancherSelecteur($("langue"), () => etat && charger());
traduire();
if (mdp) charger();
```
- [ ] **Step 3: Vérifier dans l'aperçu local**

Lancer l'aperçu `secret-santa` (`.claude/launch.json`), ouvrir `http://localhost:5174/admin.html`, puis avec le mot de passe de test :
1. Mauvais mot de passe → « Mot de passe incorrect. »
2. Créer 2 foyers, 6 participants (dont 2 sans foyer), une édition 2099 → les listes s'affichent.
3. Lancer le tirage → « Tirage effectué (6 participants)… », bouton Lancer grisé ; aucune paire visible dans la page ni dans les réponses réseau (`read_network_requests`).
4. Ajouter un participant → avertissement « tirage à refaire » ; Annuler le tirage → avertissement disparu.
5. Mettre 4 participants dans un même foyer sur 6 → « le foyer « … » regroupe plus de la moitié ».
6. Copier un lien → URL `http://localhost:5174/?t=…`.
7. Basculer EN → tous les libellés changent.

À la fin, vider les données de test (`tests/scenario.mjs` ne le fait que pour ses propres données) : SQL Editor → `truncate public.tirages, public.envies, public.participants, public.foyers, public.editions cascade;`

- [ ] **Step 4: Commit**

```bash
git add admin.html js/admin.js
git commit -m "feat: page admin (foyers, participants, édition, tirage, liens)"
```

---

### Task 6: Page participant

**Files:**
- Create: `index.html`, `js/participant.js`

**Interfaces:**
- Consumes: `appel` (Task 4) ; `t`, `traduire`, `brancherSelecteur`, `formaterDate` (Task 4) ; RPC `moi`, `mon_tirage`, `mes_envies`, `ajouter_envie`, `modifier_envie`, `supprimer_envie` (Task 2).
- Produces: page `index.html?t=<jeton>`.

- [ ] **Step 1: Écrire `index.html`**

```html
<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <meta name="referrer" content="no-referrer">
  <title>Secret Santa</title>
  <link rel="stylesheet" href="css/style.css">
</head>
<body>
  <main class="page">
    <header class="entete">
      <h1 id="bonjour" data-i18n="titre"></h1>
      <select id="langue" aria-label="Langue"><option value="fr">FR</option><option value="en">EN</option></select>
    </header>

    <div id="message" class="alerte" hidden></div>
    <p id="chargement" class="muet" data-i18n="chargement"></p>

    <section id="bloc-tirage" class="carte" hidden>
      <div id="tire" hidden>
        <p class="muet" data-i18n="tu_offres"></p>
        <p id="receveur" class="receveur"></p>
        <p id="infos" class="muet"></p>
        <h2 id="titre-envies-receveur"></h2>
        <ul id="envies-receveur" class="liste"></ul>
      </div>
      <p id="pas-tire" data-i18n="pas_tire" hidden></p>
      <p id="pas-edition" data-i18n="pas_d_edition" hidden></p>
    </section>

    <section id="bloc-envies" class="carte" hidden>
      <h2 data-i18n="mes_envies"></h2>
      <p class="muet" data-i18n="mes_envies_aide"></p>
      <ul id="mes-envies" class="liste"></ul>
      <form id="form-envie">
        <div class="ligne">
          <input id="envie-texte" maxlength="500" data-i18n-placeholder="envie_texte" required>
        </div>
        <div class="ligne" style="margin-top:8px">
          <input id="envie-lien" type="url" maxlength="1000" data-i18n-placeholder="envie_lien">
          <button class="bouton" data-i18n="ajouter"></button>
        </div>
      </form>
    </section>
  </main>
  <script type="module" src="js/participant.js"></script>
</body>
</html>
```

`<meta name="referrer" content="no-referrer">` : quand on clique sur le lien d'une envie, le site visité ne reçoit pas l'URL contenant le jeton.

- [ ] **Step 2: Écrire `js/participant.js`**

```js
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
```

- [ ] **Step 3: Vérifier dans l'aperçu local**

Avec des données de test (recréées via la page admin), ouvrir :
1. `http://localhost:5174/` → « Lien invalide… ».
2. `http://localhost:5174/?t=faux` → « Lien invalide… ».
3. Lien valide avant tirage → « Bonjour X », « Le tirage n'a pas encore eu lieu », liste d'envies modifiable.
4. Ajouter `<b>gras</b><img src=x onerror=alert(1)>` → affiché tel quel, aucune alerte.
5. Ajouter un lien `javascript:alert(1)` → « Le lien doit commencer par http:// ou https:// ».
6. Texte de 501 caractères (coller dans la console : `document.getElementById("envie-texte").removeAttribute("maxlength")`) → refusé.
7. Après tirage → prénom du receveur, budget, date au format long, ses envies avec liens cliquables (nom de domaine).
8. Désactiver ce participant dans l'admin → son lien affiche « Lien invalide ».
9. Basculer EN, recharger → l'anglais est mémorisé.

Vider les données de test à la fin (même `truncate` qu'en Task 5).

- [ ] **Step 4: Commit**

```bash
git add index.html js/participant.js
git commit -m "feat: page participant (tirage, listes d'envies)"
```

---

### Task 7: Tests sur 3 écrans et mise en ligne

**Files:**
- Modify: `css/style.css` (ajustements éventuels)
- Modify: `README.md`

**Interfaces:**
- Consumes: tout ce qui précède.
- Produces: site publié sur `https://geksmode.github.io/secret-santa/`.

- [ ] **Step 1: Tests visuels**

Avec des données de test (dont un prénom long « Marie-Christine-Anne » et une envie avec une URL de 200 caractères), dans le navigateur intégré, pour `index.html?t=…` et `admin.html` :
- `resize_window` 1280×800, puis 820×1180, puis 375×667 ;
- chaque taille en FR puis en EN ;
- vérifier : aucun défilement horizontal (`document.documentElement.scrollWidth <= innerWidth` via `javascript_tool`), boutons non coupés, URL longue qui passe à la ligne.
Corriger `css/style.css` si besoin, puis remettre `resize_window` preset `desktop`.

- [ ] **Step 2: Tests automatiques**

Run: `npm test` → Expected: PASS.
Run: `node --env-file=.env tests/securite.mjs` → Expected: `securite : OK`.

- [ ] **Step 3: Mettre à jour `README.md`**

Ajouter : comment lancer les tests, comment déployer la base (`npx supabase db push`, `npx supabase functions deploy lancer_tirage --no-verify-jwt`), comment changer le mot de passe admin (SQL de Task 2 Step 5), et le rappel « le propriétaire du projet Supabase peut techniquement lire la table `tirages` ; ne pas l'ouvrir ».

- [ ] **Step 4 (Thanh Huy) : préparer la vraie édition**

1. Vider les données de test : `truncate public.tirages, public.envies, public.participants, public.foyers, public.editions cascade;`
2. Remplacer le mot de passe admin de test par le vrai (SQL de Task 2 Step 5).

- [ ] **Step 5: Publier (avec l'accord de Thanh Huy)**

Demander l'accord explicite, puis :

```bash
git add -A
git commit -m "docs: README et ajustements responsive"
git push -u origin main
```

Activer GitHub Pages : dépôt → Settings → Pages → Source « Deploy from a branch », branche `main`, dossier `/ (root)`. Vérifier `https://geksmode.github.io/secret-santa/admin.html` (connexion), puis un lien participant en 375×667.
