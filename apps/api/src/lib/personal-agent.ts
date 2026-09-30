/**
 * Agente pessoal: o agente do próprio usuário no registry. É o assistente do painel agindo em nome do usuário,
 * com endereço @ e página próprios, para a outra ponta de uma conversa saber com quem fala e conferir
 * no registry de quem é o agente. Um por usuário, criado na primeira vez que é preciso.
 *
 * Não tem versões nem endpoint (ninguém conecta nele), fica sempre não listado e nunca vai ao hub.
 */
import { and, eq, isNull } from "drizzle-orm";
import { generateAgentId } from "@agentikal/shared";
import { db } from "../db/client.ts";
import { agents } from "../db/schema.ts";
import { env } from "../env.ts";
import { isUniqueViolation } from "./errors.ts";
import { availableHandle } from "./handles.ts";
import { refreshAgentIndex } from "./search.ts";

/** O mesmo nome para todo mundo; quem é quem é o endereço @ (único) e o dono. */
export const PERSONAL_NAME = "Agente pessoal";

export interface PersonalAgent {
  id: string;
  handle: string;
  name: string;
}

async function find(userId: string): Promise<PersonalAgent | null> {
  const [row] = await db
    .select({ id: agents.id, handle: agents.handle, name: agents.name })
    .from(agents)
    .where(and(eq(agents.ownerId, userId), eq(agents.kind, "personal"), isNull(agents.deletedAt)))
    .limit(1);
  return row ? { id: row.id, handle: row.handle ?? "", name: row.name } : null;
}

/** Devolve o agente pessoal do usuário, criando se ainda não existir. Seguro em chamadas concorrentes. */
export async function ensurePersonalAgent(user: { id: string; displayName: string }): Promise<PersonalAgent> {
  const existing = await find(user.id);
  if (existing) return existing;
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = generateAgentId(env.ID_PREFIX, env.NODE_CODE);
    const handle = await availableHandle(user.displayName);
    try {
      await db.insert(agents).values({
        id,
        ownerId: user.id,
        kind: "personal",
        name: PERSONAL_NAME,
        handle,
        summary: `Agente pessoal de ${user.displayName}: descobre, negocia e contrata outros agentes; cada compromisso passa pela confirmação de ${user.displayName}.`,
        visibility: "unlisted",
      });
      await refreshAgentIndex(id);
      return { id, handle, name: PERSONAL_NAME };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // Outra requisição criou o agente ao mesmo tempo, ou o ID/handle colidiu: confere e tenta de novo.
      const raced = await find(user.id);
      if (raced) return raced;
    }
  }
  throw new Error("Não foi possível criar o agente pessoal");
}
