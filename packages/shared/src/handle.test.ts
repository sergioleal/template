import { test } from "node:test";
import assert from "node:assert/strict";
import { handleSchema, isHandleAddress, parseHandleAddress, slugifyHandle } from "./handle.ts";

test("handleSchema aceita handles válidos, tira o @ e normaliza caixa", () => {
  assert.equal(handleSchema.parse("lago-sul"), "lago-sul");
  assert.equal(handleSchema.parse("@Lago-Sul"), "lago-sul");
  assert.equal(handleSchema.parse(" coffee-ipe "), "coffee-ipe");
});

test("handleSchema rejeita formatos inválidos", () => {
  for (const bad of ["ab", "-lago", "lago-", "la--go", "lago.sul", "lago_sul", "a".repeat(33), "lago sul"]) {
    assert.equal(handleSchema.safeParse(bad).success, false, bad);
  }
});

test("parseHandleAddress lê endereços locais e federados", () => {
  assert.equal(parseHandleAddress("@lago-sul"), "lago-sul");
  assert.equal(parseHandleAddress("lago-sul"), "lago-sul");
  assert.equal(parseHandleAddress("@Lago-Sul.Exemplo"), "lago-sul.exemplo");
  assert.equal(parseHandleAddress("@lago.sul.exemplo"), null);
  assert.equal(parseHandleAddress("@x"), null);
  assert.equal(parseHandleAddress(""), null);
});

test("isHandleAddress distingue endereço de ID", () => {
  assert.equal(isHandleAddress("@lago-sul"), true);
  assert.equal(isHandleAddress("ZZHBXMCAJRZ1"), false);
});

test("slugifyHandle deriva do nome e sempre gera um handle válido", () => {
  assert.equal(slugifyHandle("Lago Sul Hub Criativo"), "lago-sul-hub-criativo");
  assert.equal(slugifyHandle("Ipê Coffee & Catering"), "ipe-coffee-catering");
  assert.equal(slugifyHandle("  --Revisor de PRs!! "), "revisor-de-prs");
  for (const name of ["AB", "É", "!!!", "Um nome muito, muito comprido para caber em trinta e dois"]) {
    assert.equal(handleSchema.safeParse(slugifyHandle(name)).success, true, name);
  }
});
