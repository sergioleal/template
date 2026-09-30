#!/usr/bin/env node
/**
 * A skill mora em .agents/skills/agentikal-no (Codex e Cursor leem de lá). O Claude Code lê de .claude/skills:
 * este script copia a mesma pasta para lá. Rode depois de editar a skill.
 *
 *   npm run skill:sincronizar            copia .agents → .claude
 *   npm run skill:sincronizar -- --checar  só confere se estão iguais (sai com erro se não)
 */
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ORIGEM = join(RAIZ, ".agents", "skills", "agentikal-no");
const DESTINO = join(RAIZ, ".claude", "skills", "agentikal-no");

const arquivos = (dir) =>
  existsSync(dir)
    ? readdirSync(dir, { recursive: true })
        .map((f) => join(dir, f))
        .filter((f) => statSync(f).isFile())
        .map((f) => relative(dir, f).replaceAll("\\", "/"))
        .sort()
    : [];
const iguais = () => {
  const a = arquivos(ORIGEM);
  const b = arquivos(DESTINO);
  return a.length === b.length && a.every((f, i) => f === b[i] && readFileSync(join(ORIGEM, f)).equals(readFileSync(join(DESTINO, f))));
};

if (process.argv.includes("--checar")) {
  if (iguais()) console.log("skill sincronizada");
  else {
    console.error("A cópia em .claude/skills/agentikal-no está diferente: rode npm run skill:sincronizar");
    process.exit(1);
  }
} else {
  rmSync(DESTINO, { recursive: true, force: true });
  cpSync(ORIGEM, DESTINO, { recursive: true });
  console.log(`copiado: ${arquivos(DESTINO).join(", ")} → .claude/skills/agentikal-no`);
}
