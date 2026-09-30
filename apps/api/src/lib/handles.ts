/** Handles (@endereço) dos agentes: sugestão do primeiro livre e erro padrão de conflito. */
import { or, eq, like } from "drizzle-orm";
import { formatHandle, slugifyHandle } from "@agentikal/shared";
import { db } from "../db/client.ts";
import { agents } from "../db/schema.ts";
import { HttpError } from "./errors.ts";

export const HANDLE_CONSTRAINT = "agents_handle_unique";

export const handleTaken = (handle: string) =>
  new HttpError(409, "handle_taken", `O endereço ${formatHandle(handle)} já está em uso`, [
    { path: "handle", message: `${formatHandle(handle)} já está em uso; escolha outro` },
  ]);

/** Primeiro handle livre derivado do nome: "lago-sul", depois "lago-sul-2", "lago-sul-3"… */
export async function availableHandle(name: string): Promise<string> {
  const base = slugifyHandle(name);
  const rows = await db
    .select({ handle: agents.handle })
    .from(agents)
    .where(or(eq(agents.handle, base), like(agents.handle, `${base.slice(0, 28).replace(/-+$/, "")}-%`)));
  const taken = new Set(rows.map((r) => r.handle));
  if (!taken.has(base)) return base;
  const stem = base.slice(0, 28).replace(/-+$/, "");
  for (let n = 2; ; n++) if (!taken.has(`${stem}-${n}`)) return `${stem}-${n}`;
}
