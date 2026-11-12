import { test } from "node:test";
import assert from "node:assert/strict";
import { lienValide, domaine } from "../js/liens.js";

test("lienValide : vide, http(s) correct, mal formé, autre protocole", () => {
  assert.equal(lienValide(""), true);
  assert.equal(lienValide("  "), true);
  assert.equal(lienValide("https://www.exemple.fr/produit?id=3"), true);
  assert.equal(lienValide("http://exemple.fr"), true);
  for (const l of ["http://", "https://exemple.fr x", "http://[", "javascript:alert(1)", "ftp://exemple.fr", "exemple.fr"]) {
    assert.equal(lienValide(l), false, l);
  }
});

test("domaine : nom d'hôte, ou null sans planter si le lien est mal formé", () => {
  assert.equal(domaine("https://www.exemple.fr/a"), "www.exemple.fr");
  for (const l of ["http://", "https://exemple.fr x", "http://[", "javascript:alert(1)", null, ""]) {
    assert.equal(domaine(l), null, String(l));
  }
});
