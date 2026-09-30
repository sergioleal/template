import { test } from "node:test";
import assert from "node:assert/strict";
import { compareSemVer, parseSemVer, parseVersionSelector, resolveVersion, type SemVer } from "./semver.ts";

test("parse de versões válidas e inválidas", () => {
  assert.deepEqual(parseSemVer("1.2.3"), { major: 1, minor: 2, patch: 3, prerelease: null });
  assert.deepEqual(parseSemVer("1.0.0-beta.1"), { major: 1, minor: 0, patch: 0, prerelease: "beta.1" });
  for (const bad of ["1.2", "01.2.3", "1.2.3+build", "v1.2.3", "1.2.3-", "", "1.2.3.4"]) {
    assert.equal(parseSemVer(bad), null, bad);
  }
});

test("seletores de versão", () => {
  assert.equal(parseVersionSelector("1.2.3")?.kind, "exact");
  assert.deepEqual(parseVersionSelector("1.2"), { kind: "minor", major: 1, minor: 2 });
  assert.deepEqual(parseVersionSelector("1"), { kind: "major", major: 1 });
  assert.deepEqual(parseVersionSelector("latest"), { kind: "latest" });
  assert.equal(parseVersionSelector("Latest"), null);
  assert.equal(parseVersionSelector("next"), null);
});

test("resolução de seletores", () => {
  const vs = [
    ["1.0.0", false],
    ["1.2.0", false],
    ["1.2.5", true],
    ["1.10.1", false],
    ["2.0.0-rc.1", false],
  ].map(([v, yanked]) => ({ ...(parseSemVer(v as string) as SemVer), yanked: yanked as boolean, v }));
  const pick = (s: string) => resolveVersion(vs, parseVersionSelector(s)!)?.v ?? null;
  assert.equal(pick("latest"), "1.10.1");
  assert.equal(pick("1"), "1.10.1");
  assert.equal(pick("1.2"), "1.2.0"); // 1.2.5 foi retirada
  assert.equal(pick("1.2.5"), "1.2.5"); // exata ainda resolve
  assert.equal(pick("2"), null); // só pré-release
  assert.equal(pick("3.0.0"), null);

  const onlyPre = [{ ...(parseSemVer("0.1.0-alpha")!), yanked: false, v: "0.1.0-alpha" }];
  assert.equal(resolveVersion(onlyPre, { kind: "latest" })?.v, "0.1.0-alpha");
});

test("ordenação segue a precedência do semver.org", () => {
  const ordered = [
    "1.0.0-alpha",
    "1.0.0-alpha.1",
    "1.0.0-alpha.beta",
    "1.0.0-beta",
    "1.0.0-beta.2",
    "1.0.0-beta.11",
    "1.0.0-rc.1",
    "1.0.0",
    "1.9.0",
    "1.10.0",
    "2.0.0",
  ];
  const parsed = ordered.map((v) => parseSemVer(v) as SemVer);
  const sorted = [...parsed].reverse().sort(compareSemVer);
  assert.deepEqual(sorted, parsed);
});
