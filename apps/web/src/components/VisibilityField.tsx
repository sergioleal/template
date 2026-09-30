import type { Visibility } from "@agentikal/shared";
import { hubHost, isNodeInstance, useInstance } from "../instance.tsx";

const OPTIONS: { value: Visibility; title: string; text: string }[] = [
  {
    value: "public",
    title: "Público",
    text: "Aparece no catálogo público e pode ser encontrado por buscadores.",
  },
  {
    value: "unlisted",
    title: "Não listado",
    text: "Fora do catálogo. Só quem tem o link /a/<id> consegue acessar.",
  },
];

export function VisibilityField({ value, onChange }: { value: Visibility; onChange: (v: Visibility) => void }) {
  const instance = useInstance();
  const host = hubHost(instance);
  // No nó, o texto deixa claro o que sai para o hub e o que fica só aqui.
  const options = isNodeInstance(instance)
    ? [
        { value: "public" as const, title: "Público", text: `Aparece no catálogo deste registry${host ? ` e é enviado ao hub ${host}` : ""}.` },
        { value: "unlisted" as const, title: "Não listado", text: "Fica só neste registry, fora dos catálogos. Nada é enviado ao hub." },
      ]
    : OPTIONS;
  return (
    <fieldset className="choice-group">
      <legend>Visibilidade</legend>
      {options.map((o) => (
        <label key={o.value} className="choice" data-checked={value === o.value}>
          <input
            type="radio"
            name="visibility"
            value={o.value}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
          />
          <span>
            <strong>{o.title}</strong>
            <span className="muted small block">{o.text}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

export function VisibilityBadge({ value }: { value: Visibility }) {
  return value === "public" ? (
    <span className="badge ok">Público</span>
  ) : (
    <span className="badge" title="Fora do catálogo; acessível pelo link">
      Não listado
    </span>
  );
}
