import { eq, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { users } from "../db/schema.ts";
import { HttpError } from "./errors.ts";
import type { OidcIdentity } from "./oidc.ts";

/**
 * Tenant local da conta do Keycloak: pelo `sub`; no primeiro login, pelo e-mail (conta criada pelo
 * administrador, com e-mail verificado), ou um tenant novo. Contas desativadas aqui não entram.
 */
export async function tenantFor(who: Omit<OidcIdentity, "idToken">) {
  const [bySub] = await db.select().from(users).where(eq(users.oidcSub, who.sub)).limit(1);
  if (bySub) return bySub;
  if (!who.email) throw new HttpError(403, "no_email", "A conta não tem e-mail");
  const [byEmail] = await db.select().from(users).where(sql`lower(${users.email}) = ${who.email}`).limit(1);
  if (byEmail) {
    if (!who.emailVerified) throw new HttpError(403, "email_not_verified", "O e-mail da conta não está verificado");
    if (byEmail.oidcSub && byEmail.oidcSub !== who.sub) throw new HttpError(409, "account_conflict", "Este e-mail já está ligado a outra conta");
    const [linked] = await db.update(users).set({ oidcSub: who.sub }).where(eq(users.id, byEmail.id)).returning();
    return linked!;
  }
  const [created] = await db
    .insert(users)
    .values({ email: who.email, displayName: who.name ?? who.email, oidcSub: who.sub })
    .returning();
  return created!;
}

