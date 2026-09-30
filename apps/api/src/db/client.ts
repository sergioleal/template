import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../env.ts";
import * as schema from "./schema.ts";

// NOTICEs do Postgres (ex.: "schema já existe" nas migrações) não são erros; não poluímos o log com eles.
export const sql = postgres(env.DATABASE_URL, { max: 10, onnotice: () => {} });
export const db = drizzle(sql, { schema });
export type Db = typeof db;
