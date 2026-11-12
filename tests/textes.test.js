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
