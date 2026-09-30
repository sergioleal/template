/**
 * Handle: endereço legível do agente, escrito com @ (ex.: @lago-sul). O ID continua sendo a identidade
 * permanente; o handle é um apelido único na instância, que o dono pode trocar.
 *
 * - Agente local: `lago-sul` → @lago-sul.
 * - No hub, agente vindo de um nó: `lago-sul.exemplo` → @lago-sul.exemplo (sufixo = slug do nó).
 *   Handles locais não têm ponto, então nunca colidem com os federados.
 *
 * Guardado sem o @, sempre em minúsculas.
 */
import { z } from "zod";
import { normalizeAgentId } from "./id.ts";

/** 3 a 32 caracteres: letras minúsculas, números e hífen, sem começar ou terminar com hífen, sem "--". */
export const HANDLE_PATTERN = /^(?!.*--)[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;
/** Endereço completo: handle local, opcionalmente com o slug do nó de origem. */
const ADDRESS_PATTERN = /^@?((?!.*--)[a-z0-9][a-z0-9-]{1,30}[a-z0-9])(?:\.((?!.*--)[a-z0-9][a-z0-9-]{1,30}[a-z0-9]))?$/;

export const handleSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((h) => h.replace(/^@/, ""))
  .pipe(
    z
      .string()
      .regex(HANDLE_PATTERN, "Handle: 3 a 32 caracteres com letras minúsculas, números e hífen (ex.: lago-sul)"),
  );

/** "@Lago-Sul.Exemplo" → "lago-sul.exemplo"; null se não for um endereço válido. */
export function parseHandleAddress(input: string): string | null {
  const m = ADDRESS_PATTERN.exec(input.trim().toLowerCase());
  return m ? (m[2] ? `${m[1]}.${m[2]}` : m[1]!) : null;
}

/** Indica se o texto parece um endereço @ (e não um ID de agente). */
export const isHandleAddress = (input: string) => input.trim().startsWith("@") && parseHandleAddress(input) !== null;

export const formatHandle = (handle: string) => `@${handle}`;

/** Sugestão de handle a partir de um nome: "Lago Sul Hub Criativo" → "lago-sul-hub-criativo". */
export function slugifyHandle(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/, "");
  if (slug.length >= 3) return slug;
  return slug ? `${slug}-agente` : "agente";
}

/** Forma canônica de uma referência na URL: "@Lago-Sul" → "@lago-sul"; IDs seguem normalizeAgentId. */
export function normalizeAgentRef(ref: string): string {
  const trimmed = ref.trim();
  if (!trimmed.startsWith("@")) return normalizeAgentId(trimmed);
  return `@${parseHandleAddress(trimmed) ?? trimmed.slice(1).toLowerCase()}`;
}
