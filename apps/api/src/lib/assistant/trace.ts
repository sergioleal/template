/**
 * Bastidores de um turno: cada conversa do assistente com outro agente (call_agent), na ordem em que
 * aconteceu. O MCP da aplicação registra pelo token do turno; a rota do turno transmite cada entrada
 * ao vivo (SSE) e grava a lista junto da resposta, para o chat mostrar a negociação passo a passo.
 *
 * Fica em memória e vive só durante o turno, como o próprio token.
 */
import { createHash } from "node:crypto";
import type { AgentTraceEntry } from "@agentikal/shared";

const MAX_ENTRIES = 200;
const turns = new Map<string, { entries: AgentTraceEntry[]; onEntry: (e: AgentTraceEntry) => void }>();

const key = (token: string) => createHash("sha256").update(token).digest("hex");

/** Começa a registrar o turno do token. `stop` encerra e devolve o que foi registrado. */
export function startTrace(token: string, onEntry: (e: AgentTraceEntry) => void) {
  const k = key(token);
  const turn = { entries: [] as AgentTraceEntry[], onEntry };
  turns.set(k, turn);
  return {
    entries: turn.entries,
    stop: () => {
      turns.delete(k);
      return turn.entries;
    },
  };
}

/** Registra uma conversa com outro agente no turno do token (sem efeito fora de um turno). */
export function recordTrace(token: string | undefined, entry: AgentTraceEntry): void {
  const turn = token ? turns.get(key(token)) : undefined;
  if (!turn || turn.entries.length >= MAX_ENTRIES) return;
  turn.entries.push(entry);
  try {
    turn.onEntry(entry);
  } catch {
    // quem assiste (o SSE) pode ter saído; o registro continua
  }
}
