/**
 * Executor das consultas declarativas do assistente (gráficos e tabelas).
 *
 * A consulta vem do modelo, então é tratada como entrada não confiável:
 * - só campos da lista fechada de cada dataset (packages/shared/src/assistant.ts);
 * - expressões SQL vêm de um mapa fixo neste arquivo; valores entram sempre como parâmetros;
 * - o recorte do usuário (os próprios agentes, ou só os públicos no catálogo) é aplicado aqui,
 *   independente do que a consulta pede.
 */
import { sql, type SQL } from "drizzle-orm";
import { DATE_FIELDS, QUERY_DATASETS, type Query, type QueryDataset, type QueryResult } from "@agentikal/shared";
import { db } from "../../db/client.ts";
import { env, isNode } from "../../env.ts";

export class QueryError extends Error {}

interface FieldDef {
  expr: string;
  /** Junção extra necessária para o campo (ex.: unnest de tags). */
  join?: string;
  numeric?: boolean;
}

const LATEST_TOOLS = `(select jsonb_array_length(lv.tools) from agent_versions lv where lv.agent_id = a.id and lv.version = a.latest_version)`;
const VERSIONS_COUNT = `(select count(*)::int from agent_versions cv where cv.agent_id = a.id)`;
const TAG = { expr: "tg.tag", join: "left join lateral unnest(a.tags) as tg(tag) on true" };
const TRANSPORT = { expr: "tr.transport", join: "left join lateral unnest(a.latest_transports) as tr(transport) on true" };
const HUB_STATUS = {
  expr: `case when a.visibility <> 'public' then 'só aqui' when fo.last_error is not null then 'erro'
    when fo.agent_id is null or a.revision > fo.pushed_revision then 'pendente' else 'no hub' end`,
  join: "left join federation_outbox fo on fo.agent_id = a.id",
};

/** `from` é SQL fixo; `where` traz o recorte do usuário (parametrizado). */
function datasetDef(dataset: QueryDataset, userId: string): { from: string; where: SQL; fields: Record<string, FieldDef> } {
  switch (dataset) {
    case "my_agents":
      return {
        from: "from agents a",
        where: sql`a.owner_id = ${userId} and a.deleted_at is null and a.kind = 'mcp'`,
        fields: {
          agent_name: { expr: "a.name" },
          visibility: { expr: "a.visibility" },
          auth: { expr: "coalesce(a.latest_auth, 'não informado')" },
          transport: TRANSPORT,
          tag: TAG,
          created_at: { expr: "a.created_at" },
          updated_at: { expr: "a.updated_at" },
          hub_status: HUB_STATUS,
          versions_count: { expr: VERSIONS_COUNT, numeric: true },
          tools_count: { expr: LATEST_TOOLS, numeric: true },
        },
      };
    case "my_versions":
      return {
        from: "from agent_versions v join agents a on a.id = v.agent_id",
        where: sql`a.owner_id = ${userId} and a.deleted_at is null`,
        fields: {
          agent_name: { expr: "a.name" },
          version: { expr: "v.version" },
          status: { expr: "v.status" },
          auth: { expr: "coalesce(v.auth, 'não informado')" },
          tag: TAG,
          published_at: { expr: "v.published_at" },
          major: { expr: "v.major", numeric: true },
          is_prerelease: { expr: "(v.prerelease is not null)" },
          tools_count: { expr: "jsonb_array_length(v.tools)", numeric: true },
        },
      };
    case "catalog":
      return {
        from: "from agents a left join users u on u.id = a.owner_id left join federation_nodes n on n.id = a.origin_node_id",
        where: sql`a.visibility = 'public' and a.deleted_at is null and a.latest_version is not null`,
        fields: {
          agent_name: { expr: "a.name" },
          owner: { expr: "coalesce(u.display_name, a.remote_owner_name, '—')" },
          origin: { expr: `coalesce(n.name, ${quoteLiteral(env.REGISTRY_NAME ?? "este registry")})` },
          auth: { expr: "coalesce(a.latest_auth, 'não informado')" },
          transport: TRANSPORT,
          tag: TAG,
          updated_at: { expr: "a.updated_at" },
          tools_count: { expr: LATEST_TOOLS, numeric: true },
          versions_count: { expr: VERSIONS_COUNT, numeric: true },
        },
      };
  }
}

function quoteLiteral(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

const BUCKET_FORMAT = { day: "YYYY-MM-DD", week: 'IYYY-"S"IW', month: "YYYY-MM", year: "YYYY" } as const;
const isDate = (f: string) => (DATE_FIELDS as readonly string[]).includes(f);

export async function runQuery(q: Query, userId: string): Promise<QueryResult> {
  const allowed = QUERY_DATASETS[q.dataset];
  const allowedFields = new Set<string>([...allowed.dimensions, ...allowed.measures]);
  const def = datasetDef(q.dataset, userId);
  const fieldOf = (name: string, role: string): FieldDef => {
    if (!allowedFields.has(name) || !def.fields[name]) {
      throw new QueryError(`O campo "${name}" não existe em ${q.dataset} (${role}). Campos: ${[...allowedFields].join(", ")}`);
    }
    if (name === "hub_status" && !isNode) throw new QueryError("hub_status só existe em registries federados (nós).");
    return def.fields[name]!;
  };

  const joins = new Set<string>();
  const use = (f: FieldDef) => {
    if (f.join) joins.add(f.join);
    return f.expr;
  };

  // Agrupamentos
  const groups = (q.group_by ?? []).map((g) => {
    const f = fieldOf(g.field, "group_by");
    if (isDate(g.field)) {
      const bucket = g.bucket ?? "month";
      return { label: `${g.field}_${bucket}`, expr: `to_char(date_trunc('${bucket}', ${use(f)}), '${BUCKET_FORMAT[bucket]}')`, date: true };
    }
    if (g.bucket) throw new QueryError(`bucket só vale para campos de data (${g.field} não é).`);
    return { label: g.field, expr: `(${use(f)})::text`, date: false };
  });

  // Métrica
  const m = q.metric;
  let metricExpr: string;
  if (m.op === "count") metricExpr = "count(*)";
  else {
    if (!m.field) throw new QueryError(`A métrica ${m.op} precisa de um campo.`);
    const f = fieldOf(m.field, "metric");
    if ((m.op === "sum" || m.op === "avg") && !f.numeric) throw new QueryError(`${m.op} só vale para campos numéricos.`);
    metricExpr = m.op === "count_distinct" ? `count(distinct ${use(f)})` : `round(${m.op}(${use(f)})::numeric, 2)`;
  }

  // Filtros (valores sempre parametrizados)
  const filters: SQL[] = (q.filters ?? []).map((flt) => {
    const f = fieldOf(flt.field, "filters");
    const col = sql.raw(isDate(flt.field) ? use(f) : `(${use(f)})${f.numeric ? "" : "::text"}`);
    const v = flt.value;
    const cast = (x: unknown) => (isDate(flt.field) ? sql`${String(x)}::timestamptz` : f.numeric ? sql`${Number(x)}` : sql`${String(x)}`);
    switch (flt.op) {
      case "=":
        return sql`${col} = ${cast(v)}`;
      case "!=":
        return sql`${col} <> ${cast(v)}`;
      case ">=":
        return sql`${col} >= ${cast(v)}`;
      case "<=":
        return sql`${col} <= ${cast(v)}`;
      case "contains":
        return sql`${col} ilike ${`%${String(v).replace(/[\\%_]/g, (c) => `\\${c}`)}%`}`;
      case "in": {
        const list = (Array.isArray(v) ? v : [v]).map(String).slice(0, 50);
        if (!list.length) return sql`false`;
        return sql`${col} in (${sql.join(
          list.map((x) => sql`${x}`),
          sql`, `,
        )})`;
      }
    }
  });

  const limit = q.limit ?? 50;
  const sort =
    q.sort ?? (groups.some((g) => g.date) ? "label_asc" : groups.length ? "value_desc" : "value_desc");
  const orderBy =
    groups.length === 0
      ? ""
      : sort === "label_asc"
        ? `order by ${groups.map((_, i) => i + 1).join(", ")}`
        : `order by ${groups.length + 1} ${sort === "value_asc" ? "asc" : "desc"}, 1`;

  const select = sql.raw(
    [...groups.map((g) => `${g.expr} as "${g.label}"`), `${metricExpr} as "value"`].join(", "),
  );
  const fromSql = sql.raw([def.from, ...joins].join(" "));
  const where = filters.length ? sql`${def.where} and ${sql.join(filters, sql` and `)}` : def.where;
  const groupSql = groups.length ? sql.raw(`group by ${groups.map((_, i) => i + 1).join(", ")}`) : sql``;

  const rows = (await db.execute(
    sql`select ${select} ${fromSql} where ${where} ${groupSql} ${sql.raw(orderBy)} limit ${limit + 1}`,
  )) as unknown as Record<string, unknown>[];

  const columns = [...groups.map((g) => g.label), "value"];
  const truncated = rows.length > limit;
  return {
    columns,
    rows: rows.slice(0, limit).map((r) => columns.map((c) => normalize(r[c]))),
    truncated,
  };
}

function normalize(v: unknown): string | number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return String(v);
}
