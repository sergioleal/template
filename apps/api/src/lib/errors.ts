import type { FastifyError, FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { ApiError } from "@agentikal/shared";
import { renderSpa, spaEnabled } from "./spa.ts";

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    /** Erro ligado a um campo do formulário (mesmo formato da validação). */
    readonly issues?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

export const notFound = (message = "Não encontrado") => new HttpError(404, "not_found", message);

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler<FastifyError | HttpError | ZodError>((err, req, reply) => {
    let body: ApiError;
    let status: number;
    if (err instanceof ZodError) {
      status = 400;
      body = {
        error: "validation_error",
        message: "Dados inválidos",
        issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      };
    } else if (err instanceof HttpError) {
      status = err.statusCode;
      body = { error: err.code, message: err.message, ...(err.issues ? { issues: err.issues } : {}) };
    } else if (err.statusCode && err.statusCode < 500) {
      status = err.statusCode;
      body = { error: err.code ?? "bad_request", message: err.message };
    } else {
      req.log.error(err);
      status = 500;
      body = { error: "internal_error", message: "Erro interno" };
    }
    return reply.status(status).send(body);
  });

  app.setNotFoundHandler((req, reply) => {
    // Rotas do cliente (/, /login, /painel/…) caem no index.html do SPA. Caminhos de API e arquivos
    // inexistentes (com extensão) continuam 404 — um .js que falta não deve voltar como HTML.
    const path = req.url.split("?")[0]!;
    const isClientRoute =
      req.method === "GET" && !/^\/(api|mcp|federation)(\/|$)/.test(path) && !/\.[a-z0-9]+$/i.test(path);
    if (spaEnabled() && isClientRoute) return reply.type("text/html; charset=utf-8").send(renderSpa());
    return reply
      .status(404)
      .send({ error: "not_found", message: `Rota não encontrada: ${req.method} ${req.url}` } satisfies ApiError);
  });
}

/** Nome da constraint violada num erro do Postgres, quando houver. */
export function violatedConstraint(err: unknown): string | undefined {
  const e = err as { constraint_name?: string; constraint?: string; cause?: { constraint_name?: string; constraint?: string } };
  return e?.constraint_name ?? e?.constraint ?? e?.cause?.constraint_name ?? e?.cause?.constraint;
}

/** Código de violação de unicidade no Postgres. */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}
