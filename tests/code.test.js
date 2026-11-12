import { test } from "node:test";
import assert from "node:assert/strict";
import { normaliserCode, formaterCode, codePlausible, ALPHABET } from "../js/code.js";

test("normaliserCode : majuscules, sans espaces ni tirets", () => {
  assert.equal(normaliserCode(" k7mq-4xpd "), "K7MQ4XPD");
  assert.equal(normaliserCode("K7MQ 4XPD"), "K7MQ4XPD");
  assert.equal(normaliserCode(""), "");
  assert.equal(normaliserCode(null), "");
});

test("formaterCode : XXXX-XXXX", () => {
  assert.equal(formaterCode("K7MQ4XPD"), "K7MQ-4XPD");
  assert.equal(formaterCode("k7mq4xpd"), "K7MQ-4XPD");
});

test("codePlausible : 8 caractères de l'alphabet sans ambiguïté", () => {
  assert.equal(codePlausible("K7MQ-4XPD"), true);
  assert.equal(codePlausible("K7MQ4XP"), false);   // trop court
  assert.equal(codePlausible("K7MQ4XPD9"), false); // trop long
  assert.equal(codePlausible("O0I1L7MQ"), false);  // caractères ambigus exclus
});

test("alphabet : 31 caractères, sans 0 O 1 I L", () => {
  assert.equal(ALPHABET.length, 31);
  for (const c of "0O1IL") assert.ok(!ALPHABET.includes(c), c);
});
