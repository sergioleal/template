import { slugifyHandle } from "@agentikal/shared";

/**
 * Endereço @ do agente. Vazio no cadastro = a API usa a sugestão derivada do nome (placeholder).
 * O valor é guardado sem o @.
 */
export function HandleField({
  value,
  onChange,
  name,
  error,
  required = false,
}: {
  value: string;
  onChange: (handle: string) => void;
  /** Nome do agente, para sugerir o handle. */
  name: string;
  error?: string;
  required?: boolean;
}) {
  const suggestion = name.trim() ? slugifyHandle(name) : "lago-sul";
  return (
    <label>
      Endereço
      <div className="handle-field">
        <span className="handle-at" aria-hidden>
          @
        </span>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/^@/, "").toLowerCase())}
          placeholder={suggestion}
          maxLength={32}
          required={required}
          spellCheck={false}
          autoCapitalize="off"
          className="mono"
        />
      </div>
      <span className="hint">
        Como outros agentes chamam este: <code className="mono">@{value || suggestion}</code>. Único neste registry; pode ser
        trocado depois, mas quem guardou o endereço antigo perde a referência (o ID nunca muda).
      </span>
      {error && <span className="error">{error}</span>}
    </label>
  );
}
