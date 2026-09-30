/**
 * Claude Code em modo não interativo (`claude -p`), no mesmo padrão do projeto agentic:
 * usa o login do Claude Code da máquina, roda isolado (sem ferramentas próprias, sem skills,
 * sem configurações do usuário, sem sessão persistida) e devolve saída validada por JSON Schema.
 * Ferramentas, quando necessárias, vêm só de um MCP passado por --mcp-config e liberado por --allowedTools.
 *
 * O conteúdo do usuário vai por stdin, nunca por argumento.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { env } from "../env.ts";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface CliCall {
  system: string;
  input: string;
  jsonSchema: object;
  effort?: Effort;
  model?: string;
  timeoutMs?: number;
  /** Servidores MCP disponíveis nesta chamada (conteúdo do --mcp-config) e as ferramentas liberadas. */
  mcp?: { servers: Record<string, unknown>; allowedTools: string[] };
  /** Recebe os eventos do stream-json (ferramentas chamadas, texto parcial) enquanto a CLI trabalha. */
  onEvent?: (event: CliStreamEvent) => void;
  signal?: AbortSignal;
}

export interface CliResult {
  structured: unknown;
  model: string | null;
  costUsd: number | null;
  inputTokens: number;
  outputTokens: number;
  durationMs: number | null;
}

/** Subconjunto dos eventos do `--output-format stream-json` que usamos. */
export type CliStreamEvent =
  | { type: "tool_use"; name: string; input: unknown }
  | { type: "text"; text: string };

export function claudeBinary(): string {
  if (env.CLAUDE_CLI_PATH) return env.CLAUDE_CLI_PATH;
  // No Windows o `claude` global do npm é um shim .ps1/.cmd; chamamos o executável nativo direto,
  // sem shell, para os argumentos não passarem por interpretação.
  if (process.platform === "win32" && process.env.APPDATA) {
    const exe = join(process.env.APPDATA, "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
    if (existsSync(exe)) return exe;
  }
  return "claude";
}

interface ResultEvent {
  type: "result";
  is_error?: boolean;
  result?: string;
  structured_output?: unknown;
  total_cost_usd?: number;
  duration_ms?: number;
  usage?: { input_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number; output_tokens?: number };
  modelUsage?: Record<string, unknown>;
}

export class CliError extends Error {}

export function runClaude(call: CliCall): Promise<CliResult> {
  const streaming = Boolean(call.onEvent);
  const args = [
    "-p",
    "--output-format",
    streaming ? "stream-json" : "json",
    ...(streaming ? ["--verbose"] : []),
    "--json-schema",
    JSON.stringify(call.jsonSchema),
    "--system-prompt",
    call.system,
    ...(call.effort ? ["--effort", call.effort] : []),
    // Sem ferramentas próprias, MCP de fora, skills nem configurações: só o que passamos aqui.
    "--tools",
    "",
    "--strict-mcp-config",
    ...(call.mcp
      ? ["--mcp-config", JSON.stringify({ mcpServers: call.mcp.servers }), "--allowedTools", ...call.mcp.allowedTools]
      : []),
    "--setting-sources",
    "",
    "--disable-slash-commands",
    "--no-session-persistence",
    ...((call.model ?? env.CLAUDE_CLI_MODEL) ? ["--model", (call.model ?? env.CLAUDE_CLI_MODEL)!] : []),
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(claudeBinary(), args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let buffer = "";
    let stdout = "";
    let stderr = "";
    let final: ResultEvent | null = null;
    const timer = setTimeout(() => child.kill(), call.timeoutMs ?? 180_000);
    const abort = () => child.kill();
    call.signal?.addEventListener("abort", abort, { once: true });

    const handleLine = (line: string) => {
      if (!line.trim()) return;
      let ev: { type?: string; message?: { content?: { type: string; name?: string; input?: unknown; text?: string }[] } };
      try {
        ev = JSON.parse(line);
      } catch {
        return;
      }
      if (ev.type === "result") final = ev as ResultEvent;
      else if (ev.type === "assistant") {
        for (const block of ev.message?.content ?? []) {
          if (block.type === "tool_use" && block.name) call.onEvent?.({ type: "tool_use", name: block.name, input: block.input });
          else if (block.type === "text" && block.text) call.onEvent?.({ type: "text", text: block.text });
        }
      }
    };

    child.stdout.on("data", (d: Buffer) => {
      const chunk = d.toString("utf8");
      if (!streaming) {
        stdout += chunk;
        return;
      }
      buffer += chunk;
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        handleLine(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
      }
    });
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new CliError(`Não foi possível executar o Claude CLI (${e.message})`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      call.signal?.removeEventListener("abort", abort);
      if (streaming) handleLine(buffer);
      else {
        try {
          final = JSON.parse(stdout) as ResultEvent;
        } catch {
          final = null;
        }
      }
      const r = final as ResultEvent | null;
      if (!r) return reject(new CliError(`Claude CLI terminou sem resultado (código ${code}) ${stderr.slice(0, 300)}`));
      if (r.is_error) return reject(new CliError(`Claude CLI: ${String(r.result ?? "erro").slice(0, 300)}`));
      const u = r.usage ?? {};
      resolve({
        structured: r.structured_output ?? tryParse(r.result),
        model: Object.keys(r.modelUsage ?? {})[0]?.replace(/\[.*\]$/, "") ?? null,
        costUsd: r.total_cost_usd ?? null,
        inputTokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
        outputTokens: u.output_tokens ?? 0,
        durationMs: r.duration_ms ?? null,
      });
    });
    child.stdin.end(call.input, "utf8");
  });
}

function tryParse(s: string | undefined): unknown {
  try {
    return s ? JSON.parse(s) : undefined;
  } catch {
    return undefined;
  }
}
