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

// ---------- Tirage assoupli : quand on ne peut pas séparer toutes les familles ----------

function familles(tailles: Record<string, number>, seuls = 0): Participant[] {
  const ps: Participant[] = [];
  for (const [f, k] of Object.entries(tailles)) for (let i = 0; i < k; i++) ps.push({ id: `${f}${i}`, foyer: f });
  for (let i = 0; i < seuls; i++) ps.push({ id: `s${i}`, foyer: null });
  return ps;
}
function entorsesDe(ps: Participant[], paires: Paire[]): number {
  const f = new Map(ps.map((p) => [p.id, p.foyer]));
  return paires.filter((x) => f.get(x.donneur) !== null && f.get(x.donneur) === f.get(x.receveur)).length;
}
function bijectionSansSoi(ps: Participant[], paires: Paire[]) {
  assert.equal(paires.length, ps.length);
  assert.deepEqual(new Set(paires.map((x) => x.donneur)), new Set(ps.map((p) => p.id)));
  assert.deepEqual(new Set(paires.map((x) => x.receveur)), new Set(ps.map((p) => p.id)));
  for (const x of paires) assert.notEqual(x.donneur, x.receveur);
}

test("familles de 6 et 4 : exactement 2 cadeaux internes (le minimum), personne ne se tire soi-même", () => {
  const ps = familles({ A: 6, B: 4 });
  const rng = rngGraine(11);
  for (let i = 0; i < 2000; i++) {
    const r = tirer(ps, new Map(), rng);
    assert.ok(r.ok);
    if (!r.ok) return;
    bijectionSansSoi(ps, r.paires);
    assert.equal(entorsesDe(ps, r.paires), 2);
    assert.equal(r.entorses, 2);
  }
});

test("famille de 3 sur 5 : 1 seul cadeau interne", () => {
  const ps = familles({ A: 3 }, 2);
  const r = tirer(ps, new Map(), rngGraine(12));
  assert.ok(r.ok);
  if (r.ok) { bijectionSansSoi(ps, r.paires); assert.equal(r.entorses, 1); assert.equal(entorsesDe(ps, r.paires), 1); }
});

test("tout le monde dans la même famille : tirage quand même, sans soi-même", () => {
  const ps = familles({ A: 5 });
  const r = tirer(ps, new Map(), rngGraine(13));
  assert.ok(r.ok);
  if (r.ok) { bijectionSansSoi(ps, r.paires); assert.equal(r.entorses, 5); }
});

test("tirage normal : 0 entorse annoncée", () => {
  const r = tirer(famille(), new Map(), rngGraine(14));
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.entorses, 0);
});

test("6 et 4 : le tirage assoupli varie et chaque membre de A peut être celui qui offre en interne", () => {
  const ps = familles({ A: 6, B: 4 });
  const rng = rngGraine(15);
  const internes = new Set<string>();
  const vus = new Set<string>();
  for (let i = 0; i < 400; i++) {
    const r = tirer(ps, new Map(), rng);
    if (!r.ok) continue;
    vus.add(JSON.stringify(r.paires.slice().sort((p, q) => p.donneur.localeCompare(q.donneur))));
    for (const x of r.paires) if (x.donneur[0] === "A" && x.receveur[0] === "A") internes.add(x.donneur);
  }
  assert.equal(internes.size, 6);
  assert.ok(vus.size > 300);
});

test("2 personnes qui se sont tirées l'an dernier : on refait le même échange (seule option)", () => {
  const ps = [{ id: "x", foyer: null }, { id: "y", foyer: null }];
  const prec = new Map([["x", "y"], ["y", "x"]]);
  const r = tirer(ps, prec, rngGraine(4));
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.entorses, 2);
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

// ---------- Couples : on n'offre jamais à son conjoint, même quand le tirage est assoupli ----------

function avecCouples(ps: Participant[], couples: [string, string][]): Participant[] {
  const c = new Map<string, string>();
  for (const [x, y] of couples) { c.set(x, y); c.set(y, x); }
  return ps.map((p) => ({ ...p, conjoint: c.get(p.id) ?? null }));
}
function aucunConjoint(ps: Participant[], paires: Paire[]) {
  const c = new Map(ps.map((p) => [p.id, p.conjoint ?? null]));
  for (const x of paires) assert.notEqual(c.get(x.donneur), x.receveur, "cadeau à son conjoint");
}

test("estAutorise : pas son conjoint", () => {
  const x = { id: "x", foyer: null, conjoint: "y" }, y = { id: "y", foyer: null, conjoint: "x" };
  assert.equal(estAutorise(x, y, new Map()), false);
});

test("6 et 4 avec couples dans chaque famille : 2 cadeaux internes, jamais à son conjoint", () => {
  const ps = avecCouples(familles({ A: 6, B: 4 }), [["A0", "A1"], ["A2", "A3"], ["A4", "A5"], ["B0", "B1"], ["B2", "B3"]]);
  const rng = rngGraine(21);
  const internes = new Set<string>();
  for (let i = 0; i < 2000; i++) {
    const r = tirer(ps, new Map(), rng);
    assert.ok(r.ok);
    if (!r.ok) return;
    bijectionSansSoi(ps, r.paires);
    aucunConjoint(ps, r.paires);
    assert.equal(r.entorses, 2);
    assert.equal(entorsesDe(ps, r.paires), 2);
    for (const x of r.paires) if (x.donneur[0] === "A" && x.receveur[0] === "A") internes.add(x.donneur);
  }
  assert.equal(internes.size, 6, "chaque membre de A peut offrir en interne");
});

test("tout le monde dans la même famille, en couples : jamais à son conjoint", () => {
  const ps = avecCouples(familles({ A: 4 }), [["A0", "A1"], ["A2", "A3"]]);
  const rng = rngGraine(22);
  for (let i = 0; i < 500; i++) {
    const r = tirer(ps, new Map(), rng);
    assert.ok(r.ok);
    if (r.ok) { bijectionSansSoi(ps, r.paires); aucunConjoint(ps, r.paires); }
  }
});

test("seulement un couple : impossible", () => {
  const ps = avecCouples(familles({ A: 2 }), [["A0", "A1"]]);
  assert.deepEqual(tirer(ps, new Map(), rngGraine(23)), { ok: false, raison: "impossible" });
});
