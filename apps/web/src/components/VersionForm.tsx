import { AUTH_TYPES, extractTools, REMOTE_TYPES, type AgentTool, type AuthType, type Remote, type RemoteType } from "@agentikal/shared";

export interface VersionDraft {
  version: string;
  description: string;
  remotes: Remote[];
  auth: AuthType | null;
  /** JSON colado pelo dono: resposta de tools/list, o objeto result ou só o array. */
  toolsText: string;
  /** Frases de exemplo de conversa (o /ex do chat), uma por linha. */
  examplesText: string;
}

export const emptyDraft = (version = "1.0.0"): VersionDraft => ({
  version,
  description: "",
  remotes: [{ type: "streamable-http", url: "" }],
  auth: null,
  toolsText: "",
  examplesText: "",
});

export const toolsToText = (tools: AgentTool[]) => (tools.length ? JSON.stringify({ tools }, null, 2) : "");

export const examplesToText = (examples: string[]) => examples.join("\n");
export const textToExamples = (text: string) => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

const AUTH_LABELS: Record<AuthType, string> = {
  none: "Sem autenticação",
  api_key: "Chave de API",
  oauth2: "OAuth 2.0",
  other: "Outra",
};

/** Converte o rascunho no corpo da API; o JSON das ferramentas é interpretado aqui. */
export function draftToInput(d: VersionDraft): { input: unknown; toolsError?: string } {
  const { toolsText, examplesText, ...fields } = d;
  const rest = { ...fields, examples: textToExamples(examplesText) };
  if (!toolsText.trim()) return { input: { ...rest, tools: [] } };
  try {
    return { input: { ...rest, tools: extractTools(JSON.parse(toolsText)) } };
  } catch {
    return { input: { ...rest, tools: [] }, toolsError: "JSON inválido" };
  }
}

interface Props {
  value: VersionDraft;
  onChange: (next: VersionDraft) => void;
  errors: Record<string, string>;
  /** Prefixo do caminho de erro (ex.: "firstVersion" no formulário de criação). */
  errorPrefix?: string;
}

/** Campos de uma versão: número x.y.z, endpoints MCP, autenticação, ferramentas e descrição (Markdown). */
export function VersionFields({ value, onChange, errors, errorPrefix }: Props) {
  const err = (path: string) => errors[errorPrefix ? `${errorPrefix}.${path}` : path];
  const toolsKey = errorPrefix ? `${errorPrefix}.tools` : "tools";
  const setRemote = (i: number, patch: Partial<Remote>) =>
    onChange({ ...value, remotes: value.remotes.map((r, j) => (j === i ? { ...r, ...patch } : r)) });

  return (
    <>
      <label>
        Versão
        <input
          className="mono"
          value={value.version}
          onChange={(e) => onChange({ ...value, version: e.target.value })}
          placeholder="1.0.0"
          required
        />
        <span className="hint">Semver x.y.z. Versões publicadas não podem ser alteradas, só retiradas.</span>
        {err("version") && <span className="error">{err("version")}</span>}
      </label>

      <fieldset>
        <legend>Endpoints MCP</legend>
        {value.remotes.map((r, i) => (
          <div className="remote-row" key={i}>
            <select
              aria-label="Transporte"
              value={r.type}
              onChange={(e) => setRemote(i, { type: e.target.value as RemoteType })}
            >
              {REMOTE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <input
              aria-label="URL do MCP"
              type="url"
              className="mono"
              placeholder="https://exemplo.br/mcp"
              value={r.url}
              onChange={(e) => setRemote(i, { url: e.target.value })}
              required
            />
            {value.remotes.length > 1 && (
              <button
                type="button"
                className="ghost"
                aria-label="Remover endpoint"
                onClick={() => onChange({ ...value, remotes: value.remotes.filter((_, j) => j !== i) })}
              >
                ×
              </button>
            )}
            {err(`remotes.${i}.url`) && <span className="error full">{err(`remotes.${i}.url`)}</span>}
          </div>
        ))}
        {err("remotes") && <span className="error">{err("remotes")}</span>}
        {value.remotes.length < 10 && (
          <button
            type="button"
            className="ghost"
            onClick={() => onChange({ ...value, remotes: [...value.remotes, { type: "streamable-http", url: "" }] })}
          >
            + Adicionar endpoint
          </button>
        )}
      </fieldset>

      <label>
        Autenticação
        <select
          value={value.auth ?? ""}
          onChange={(e) => onChange({ ...value, auth: (e.target.value || null) as AuthType | null })}
        >
          <option value="">Não informada</option>
          {AUTH_TYPES.map((t) => (
            <option key={t} value={t}>
              {AUTH_LABELS[t]}
            </option>
          ))}
        </select>
        <span className="hint">Ajuda outros agentes a saber se conseguem se conectar.</span>
      </label>

      <label>
        Ferramentas (manifesto MCP)
        <textarea
          rows={6}
          className="mono small-text"
          value={value.toolsText}
          onChange={(e) => onChange({ ...value, toolsText: e.target.value })}
          placeholder={'Cole a resposta de tools/list do seu servidor MCP, ex.:\n{ "tools": [ { "name": "buscar", "description": "…", "inputSchema": { … } } ] }'}
          spellCheck={false}
        />
        <span className="hint">
          Opcional, mas é o que mais ajuda na busca: outros agentes encontram o seu pelas ferramentas e podem conferir os
          schemas antes de conectar.
        </span>
        {Object.entries(errors)
          .filter(([k]) => k === toolsKey || k.startsWith(`${toolsKey}.`))
          .slice(0, 3)
          .map(([k, m]) => {
            // "tools.2.name" → "Ferramenta 3: <mensagem>"
            const index = /\.(\d+)/.exec(k.slice(toolsKey.length))?.[1];
            return (
              <span key={k} className="error">
                {index !== undefined ? `Ferramenta ${Number(index) + 1}: ` : ""}
                {m}
              </span>
            );
          })}
      </label>

      <label>
        Exemplos de conversa
        <textarea
          rows={4}
          value={value.examplesText}
          onChange={(e) => onChange({ ...value, examplesText: e.target.value })}
          placeholder={"Uma frase por linha, como alguém pediria ao próprio agente, ex.:\nPede ao @meu-agente para conciliar o extrato de setembro."}
        />
        <span className="hint">
          Opcional. Aparecem no /ex do chat: a pessoa toca numa frase e ela vai para o agente pessoal dela, que fala com este.
        </span>
        {Object.entries(errors)
          .filter(([k]) => k === (errorPrefix ? `${errorPrefix}.examples` : "examples") || k.startsWith(`${errorPrefix ? `${errorPrefix}.` : ""}examples.`))
          .slice(0, 2)
          .map(([k, m]) => (
            <span key={k} className="error">
              {m}
            </span>
          ))}
      </label>

      <label>
        Descrição
        <textarea
          rows={10}
          value={value.description}
          onChange={(e) => onChange({ ...value, description: e.target.value })}
          placeholder="O que o agente faz, ferramentas expostas, como autenticar…"
          required
        />
        <span className="hint">Aceita Markdown. É o conteúdo exibido na página pública.</span>
        {err("description") && <span className="error">{err("description")}</span>}
      </label>
    </>
  );
}
