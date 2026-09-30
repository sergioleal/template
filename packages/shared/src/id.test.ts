import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkDigit,
  generateAgentId,
  isValidAgentId,
  isValidNodeCode,
  nodeCodeOf,
  normalizeAgentId,
  randomNodeCode,
} from "./id.ts";

test("dígito verificador bate com ISINs reais conhecidos", () => {
  for (const isin of ["US0378331005", "US5949181045", "DE000BAY0017", "GB0002634946"]) {
    assert.equal(checkDigit(isin.slice(0, 11)), Number(isin[11]), isin);
    assert.ok(isValidAgentId(isin));
  }
});

test("gera IDs válidos com o prefixo pedido", () => {
  for (let i = 0; i < 1000; i++) {
    const id = generateAgentId("ZZ");
    assert.equal(id.length, 12);
    assert.ok(id.startsWith("ZZ"));
    assert.ok(isValidAgentId(id), id);
    assert.doesNotMatch(id.slice(2, 11), /[IO]/);
  }
});

test("rejeita erros de digitação e formato", () => {
  const id = generateAgentId("ZZ");
  const wrong = id.slice(0, 11) + ((Number(id[11]) + 1) % 10);
  assert.equal(isValidAgentId(wrong), false);
  assert.equal(isValidAgentId("Z" + id), false);
  assert.equal(isValidAgentId(normalizeAgentId(` ${id.slice(0, 6)}-${id.slice(6).toLowerCase()} `)), true);
});

test("prefixo inválido lança erro", () => {
  assert.throws(() => generateAgentId("Z1"));
});

test("IDs com código de nó", () => {
  for (let i = 0; i < 500; i++) {
    const id = generateAgentId("ZZ", "K7");
    assert.ok(isValidAgentId(id), id);
    assert.equal(nodeCodeOf(id), "K7");
  }
  assert.ok(isValidNodeCode(randomNodeCode()));
  // I e O ficam fora do alfabeto de geração, então não são códigos de nó.
  for (const bad of ["K", "K7X", "k7", "IO", "O1"]) assert.equal(isValidNodeCode(bad), false, bad);
  assert.throws(() => generateAgentId("ZZ", "IO"));
});
