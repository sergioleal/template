/**
 * Token de turno: credencial curta que a CLI usa para chamar o MCP da aplicação em nome do usuário.
 * Vale só durante um turno (revogado ao final) e só para leitura — o MCP da aplicação não tem
 * ferramentas que alterem dados. Fica em memória: a CLI chama de volta o mesmo processo (loopback).
 */
import { createHash, randomBytes } from "node:crypto";

const TTL_MS = 10 * 60_000;
const tokens = new Map<string, { userId: string; expiresAt: number }>();

const hash = (t: string) => createHash("sha256").update(t).digest("hex");

export function issueTurnToken(userId: string): { token: string; revoke: () => void } {
  const token = randomBytes(32).toString("base64url");
  const key = hash(token);
  tokens.set(key, { userId, expiresAt: Date.now() + TTL_MS });
  return { token, revoke: () => tokens.delete(key) };
}

export function userForTurnToken(token: string | undefined): string | null {
  if (!token) return null;
  const entry = tokens.get(hash(token));
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    tokens.delete(hash(token));
    return null;
  }
  return entry.userId;
}
