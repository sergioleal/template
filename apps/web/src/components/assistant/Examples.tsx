/**
 * Comando /ex do chat: as frases de exemplo, e clicar numa a envia como a próxima mensagem. Vêm do registry
 * (GET /api/assistant/examples): as gerais e as de cada agente que o dono declarou na versão (ex.: as de team
 * building no @tbuilder). O comando não vai ao agente nem fica na conversa.
 */
import { useEffect, useState } from "react";
import type { ExampleGroup } from "@agentikal/shared";
import { api } from "../../api.ts";

export const EXAMPLES_COMMAND = "/ex";

export const isExamplesCommand = (text: string) => text.trim().toLowerCase() === EXAMPLES_COMMAND;

/** Cartão com as frases; `onPick` envia a escolhida. */
export function ExamplesBlock({ onPick, onClose }: { onPick: (phrase: string) => void; onClose: () => void }) {
  const [groups, setGroups] = useState<ExampleGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.get<{ groups: ExampleGroup[] }>("/api/assistant/examples").then(
      (r) => setGroups(r.groups),
      (e: Error) => setError(e.message),
    );
  }, []);

  return (
    <div className="bubble assistant chat-examples">
      <div className="chat-examples-head">
        <strong>Frases de exemplo</strong>
        <button type="button" className="ghost small" onClick={onClose} aria-label="Fechar exemplos">
          ✕
        </button>
      </div>
      <p className="muted">Clique numa frase para enviá-la ao seu agente.</p>
      {error && <p className="error">{error}</p>}
      {!groups && !error && <div className="skeleton chat-skeleton" />}
      {groups?.map((g) => (
        <section key={g.agent?.id ?? g.title}>
          <h3>
            {g.title}
            {g.agent?.handle && <span className="agent-handle"> {g.agent.handle}</span>}
          </h3>
          <div className="chat-suggestions">
            {g.phrases.map((p) => (
              <button key={p} type="button" className="secondary" onClick={() => onPick(p)}>
                {p}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
