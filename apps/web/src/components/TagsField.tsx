import { useState } from "react";
import { TAG_PATTERN } from "@agentikal/shared";

/** Tags como chips: Enter, vírgula ou espaço confirmam; Backspace no campo vazio remove a última. */
export function TagsField({ value, onChange, error }: { value: string[]; onChange: (tags: string[]) => void; error?: string }) {
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState<string | null>(null);

  /** Confirma um ou mais termos de uma vez (colar "a, b c" vira três tags). */
  const commit = (raw: string) => {
    const next = [...value];
    for (const part of raw.split(/[,\s]+/)) {
      const tag = part.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
      if (!tag) continue;
      if (!TAG_PATTERN.test(tag)) return setInvalid(`"${part}" não é uma tag válida`);
      if (!next.includes(tag) && next.length < 10) next.push(tag);
    }
    setInvalid(null);
    if (next.length !== value.length) onChange(next);
    setDraft("");
  };

  return (
    <label>
      Tags
      <div className="tags-field">
        {value.map((t) => (
          <span key={t} className="badge tag">
            {t}
            <button type="button" aria-label={`Remover ${t}`} onClick={() => onChange(value.filter((x) => x !== t))}>
              ×
            </button>
          </span>
        ))}
        <input
          value={draft}
          placeholder={value.length ? "" : "ex.: finance, accounting"}
          onChange={(e) => {
            // Tudo antes do último separador vira tag; o que vem depois continua em edição.
            const v = e.target.value;
            const cut = Math.max(v.lastIndexOf(","), v.search(/\s\S*$/));
            if (cut >= 0) {
              commit(v.slice(0, cut));
              setDraft(v.slice(cut + 1));
            } else setDraft(v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit(draft);
            } else if (e.key === "Backspace" && !draft && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={() => commit(draft)}
          disabled={value.length >= 10}
        />
      </div>
      <span className="hint">Até 10. Letras minúsculas, números e hífen. Viram filtros no catálogo e na busca do MCP.</span>
      {(invalid || error) && <span className="error">{invalid ?? error}</span>}
    </label>
  );
}
