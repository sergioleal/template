/** Versões semânticas x.y.z (semver 2.0.0), com pré-release opcional; build metadata é rejeitado. */

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
}

// Regex oficial do semver.org, sem o grupo de build metadata (não faz sentido numa URL de registro).
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?$/;

// Os componentes são guardados como INTEGER no Postgres.
const MAX_COMPONENT = 2_147_483_647;

export function parseSemVer(input: string): SemVer | null {
  const m = SEMVER_PATTERN.exec(input);
  if (!m) return null;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const patch = Number(m[3]);
  if (major > MAX_COMPONENT || minor > MAX_COMPONENT || patch > MAX_COMPONENT) return null;
  return { major, minor, patch, prerelease: m[4] ?? null };
}

export function formatSemVer(v: SemVer): string {
  return `${v.major}.${v.minor}.${v.patch}${v.prerelease ? `-${v.prerelease}` : ""}`;
}

/**
 * Seletor de versão usado na URL /a/<id>/v/<seletor>:
 *   "1.2.3" / "1.2.3-beta.1" → versão exata
 *   "1.2"                    → última estável 1.2.x
 *   "1"                      → última estável 1.x
 *   "latest"                 → última estável (ou, se não houver, a pré-release mais recente); é o que /a/<id> serve
 */
export type VersionSelector =
  | { kind: "latest" }
  | { kind: "exact"; version: SemVer }
  | { kind: "minor"; major: number; minor: number }
  | { kind: "major"; major: number };

export const LATEST = "latest";

export function parseVersionSelector(input: string): VersionSelector | null {
  if (input === LATEST) return { kind: "latest" };
  const exact = parseSemVer(input);
  if (exact) return { kind: "exact", version: exact };
  let m = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/.exec(input);
  if (m) return { kind: "minor", major: Number(m[1]), minor: Number(m[2]) };
  m = /^(0|[1-9]\d{0,8})$/.exec(input);
  if (m) return { kind: "major", major: Number(m[1]) };
  return null;
}

function comparePrerelease(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1; // estável > pré-release
  if (b === null) return -1;
  const pa = a.split(".");
  const pb = b.split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i];
    const y = pb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) {
      const d = Number(x) - Number(y);
      if (d !== 0) return Math.sign(d);
    } else if (xn !== yn) {
      return xn ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

export function compareSemVer(a: SemVer, b: SemVer): number {
  return (
    Math.sign(a.major - b.major) ||
    Math.sign(a.minor - b.minor) ||
    Math.sign(a.patch - b.patch) ||
    comparePrerelease(a.prerelease, b.prerelease)
  );
}

export interface ResolvableVersion extends SemVer {
  yanked: boolean;
}

/**
 * Resolve um seletor contra as versões existentes.
 * - exata: devolve mesmo se retirada (yanked) — quem fixou a versão precisa ver o aviso;
 * - flutuantes (latest, 1, 1.2): ignoram versões retiradas e pré-releases
 *   (latest cai para a pré-release mais recente só quando não existe nenhuma estável).
 */
export function resolveVersion<T extends ResolvableVersion>(versions: T[], selector: VersionSelector): T | null {
  if (selector.kind === "exact") {
    return versions.find((v) => compareSemVer(v, selector.version) === 0) ?? null;
  }
  const live = versions.filter((v) => !v.yanked).sort((a, b) => compareSemVer(b, a));
  const stable = live.filter((v) => v.prerelease === null);
  switch (selector.kind) {
    case "latest":
      return stable[0] ?? live[0] ?? null;
    case "major":
      return stable.find((v) => v.major === selector.major) ?? null;
    case "minor":
      return stable.find((v) => v.major === selector.major && v.minor === selector.minor) ?? null;
  }
}
