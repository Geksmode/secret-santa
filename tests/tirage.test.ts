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
