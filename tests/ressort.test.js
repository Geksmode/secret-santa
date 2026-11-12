import { test } from "node:test";
import assert from "node:assert/strict";
import { creerRessort, avancer, projeter, elastique } from "../js/ressort.js";

function simuler(r, duree, pas = 1 / 120) {
  const xs = [];
  for (let t = 0; t < duree; t += pas) { avancer(r, pas); xs.push(r.x); }
  return xs;
}

test("amortissement 1 : atteint la cible sans la dépasser", () => {
  const r = creerRessort({ de: 0, vers: 100, amortissement: 1, reponse: 0.4 });
  const xs = simuler(r, 1.5);
  assert.ok(Math.max(...xs) <= 100.01, `dépassement ${Math.max(...xs)}`);
  assert.ok(Math.abs(xs.at(-1) - 100) < 0.5, `fin ${xs.at(-1)}`);
  assert.equal(r.arrete, true);
});

test("amortissement 0.8 : léger dépassement puis stabilisation", () => {
  const r = creerRessort({ de: 0, vers: 100, amortissement: 0.8, reponse: 0.4 });
  const xs = simuler(r, 2);
  const max = Math.max(...xs);
  assert.ok(max > 100.5 && max < 110, `dépassement ${max}`);
  assert.ok(Math.abs(xs.at(-1) - 100) < 0.5);
});

test("réponse : plus petite = plus rapide", () => {
  const rapide = creerRessort({ de: 0, vers: 100, reponse: 0.2 });
  const lent = creerRessort({ de: 0, vers: 100, reponse: 0.6 });
  simuler(rapide, 0.2); simuler(lent, 0.2);
  assert.ok(rapide.x > lent.x);
});

test("vitesse initiale : le mouvement part dans le sens du geste", () => {
  const r = creerRessort({ de: 50, vers: 50, vitesse: 1000, reponse: 0.4 });
  avancer(r, 1 / 60);
  assert.ok(r.x > 50);
});

test("pas de temps énorme (onglet en arrière-plan) : reste stable", () => {
  const r = creerRessort({ de: 0, vers: 100, reponse: 0.3 });
  avancer(r, 5);
  assert.ok(Number.isFinite(r.x) && Math.abs(r.x - 100) < 1, `x=${r.x}`);
});

test("projeter : formule d'Apple, 0 sans vitesse", () => {
  assert.equal(projeter(0), 0);
  assert.ok(Math.abs(projeter(1000) - 499) < 1);
  assert.ok(projeter(-1000) < 0);
});

test("elastique : résiste de plus en plus, borné par la dimension", () => {
  assert.equal(elastique(0, 200), 0);
  const a = elastique(50, 200), b = elastique(500, 200);
  assert.ok(a > 0 && a < 50);
  assert.ok(b > a && b < 200 * 0.55 * 1.0001 + 1e-9 + 200);
  assert.ok(elastique(-50, 200) === -a);
});
