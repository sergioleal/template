import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AgentTraceEntry, AssistantConversation, AssistantMessage, TurnEvent } from "@agentikal/shared";
import { api, postStream, RequestError } from "../api.ts";
import { Icon } from "../components/Layout.tsx";
import { EventText, UiBlock } from "../components/assistant/UiBlocks.tsx";
import { EXAMPLES_COMMAND, ExamplesBlock, isExamplesCommand } from "../components/assistant/Examples.tsx";
import { NegotiationTrace, traceCurrency } from "../components/assistant/NegotiationTrace.tsx";
import { isNodeInstance, pageTitle, useInstance } from "../instance.tsx";

const SUGGESTIONS = [
  "Quais agentes eu tenho e qual a versão latest de cada um?",
  "Mostre um gráfico de versões publicadas por mês",
  "Quero registrar um agente novo",
  "Quantos agentes do catálogo usam cada tipo de autenticação?",
];

export function AssistantPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const instance = useInstance();
  const [conversations, setConversations] = useState<AssistantConversation[]>([]);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [progress, setProgress] = useState<string[]>([]);
  // Conversas com outros agentes no turno em andamento, conforme chegam.
  const [liveTrace, setLiveTrace] = useState<AgentTraceEntry[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  // Cartão do /ex: só na tela, não vai ao agente nem fica na conversa.
  const [showExamples, setShowExamples] = useState(false);
  const [me, setMe] = useState<{ id: string; handle: string; name: string; agentCalls: boolean } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const suggestions = isNodeInstance(instance)
    ? [...SUGGESTIONS.slice(0, 3), "Quais agentes meus já estão no hub?"]
    : SUGGESTIONS;

  useEffect(() => {
    document.title = pageTitle(instance, "Assistente");
    api.get<AssistantConversation[]>("/api/assistant/conversations").then(setConversations, () => {});
    api.get<{ id: string; handle: string; name: string; agentCalls: boolean }>("/api/assistant/agent").then(setMe, () => {});
  }, [instance]);

  useEffect(() => {
    setError(null);
    setProgress([]);
    setLiveTrace([]);
    setShowExamples(false);
    if (!id) {
      setMessages([]);
      return;
    }
    api
      .get<{ conversation: AssistantConversation; messages: AssistantMessage[] }>(`/api/assistant/conversations/${id}`)
      .then((r) => setMessages(r.messages), (e: Error) => setError(e.message));
  }, [id]);

  // Turno em andamento de outra carga da página (recarregou no meio): a última mensagem é do usuário e
  // ainda não tem resposta. A API termina o turno mesmo assim; aqui só esperamos a resposta chegar.
  const awaiting = !sending && messages.at(-1)?.role === "user";
  useEffect(() => {
    if (!awaiting || !id) return;
    const started = Date.now();
    const t = setInterval(() => {
      if (Date.now() - started > 10 * 60_000) return clearInterval(t);
      api
        .get<{ conversation: AssistantConversation; messages: AssistantMessage[] }>(`/api/assistant/conversations/${id}`)
        .then((r) => {
          if (r.messages.at(-1)?.role !== "user") setMessages(r.messages);
        }, () => {});
    }, 3000);
    return () => clearInterval(t);
  }, [awaiting, id]);

  // Corpo com chaves: em navegadores recentes scrollIntoView devolve uma Promise, e o React
  // trataria o retorno como função de limpeza.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, progress, showExamples]);

  const send = async (raw: string) => {
    const message = raw.trim();
    if (!message || sending) return;
    if (isExamplesCommand(message)) {
      setText("");
      setShowExamples(true);
      return;
    }
    setShowExamples(false);
    setSending(true);
    setError(null);
    setProgress([]);
    setLiveTrace([]);
    setText("");
    try {
      let convId = id;
      if (!convId) {
        const c = await api.post<AssistantConversation>("/api/assistant/conversations");
        convId = c.id;
        setConversations((cs) => [c, ...cs]);
        navigate(`/painel/assistente/${c.id}`, { replace: true });
      }
      await postStream<TurnEvent>(`/api/assistant/conversations/${convId}/turn`, { text: message }, (ev) => {
        if (ev.type === "message") setMessages((ms) => [...ms.filter((m) => m.id !== ev.message.id), ev.message]);
        else if (ev.type === "progress") setProgress((p) => (p.at(-1) === ev.label ? p : [...p, ev.label]));
        else if (ev.type === "trace") setLiveTrace((t) => [...t, ev.entry]);
        else setError(ev.message);
      });
      api.get<AssistantConversation[]>("/api/assistant/conversations").then(setConversations, () => {});
    } catch (err) {
      setError(err instanceof RequestError ? err.message : "Falha ao falar com o assistente");
    } finally {
      setSending(false);
      setProgress([]);
    setLiveTrace([]);
    }
  };

  const recordEvent = (ref: string) => async (eventText: string) => {
    if (!id) return;
    const ev = await api.post<AssistantMessage>(`/api/assistant/conversations/${id}/events`, { text: eventText, ref });
    setMessages((ms) => [...ms, ev]);
  };

  const callAgent = (ref: string) => async () => {
    if (!id) return;
    const ev = await api.post<AssistantMessage>(`/api/assistant/conversations/${id}/agent-call`, { ref });
    setMessages((ms) => [...ms, ev]);
  };

  const doneByRef = new Map(
    messages.filter((m): m is Extract<AssistantMessage, { role: "event" }> => m.role === "event" && !!m.ref).map((m) => [m.ref!, m.text]),
  );

  return (
    <div className="assistant-layout">
      <aside className="assistant-list">
        <button type="button" className="button block" onClick={() => navigate("/painel/assistente")}>
          <Icon d="M12 5v14M5 12h14" /> Nova conversa
        </button>
        <ul>
          {conversations.map((c) => (
            <li key={c.id}>
              <Link to={`/painel/assistente/${c.id}`} className={c.id === id ? "active" : undefined}>
                {c.title}
              </Link>
            </li>
          ))}
        </ul>
      </aside>

      <section className="assistant-chat">
        {me && (
          <div className="chat-identity">
            Você está falando com o seu agente{" "}
            <Link to={`/a/${me.id}`} className="agent-handle">
              {me.handle}
            </Link>
            {me.agentCalls ? ", que também conversa com outros agentes por você." : "."}
          </div>
        )}
        <div className="chat-scroll">
          {messages.length === 0 && !sending && !showExamples && (
            <div className="chat-empty">
              <span className="feature-icon">
                <Icon d="M8 10h8M8 14h5M21 12a9 9 0 0 1-13.5 7.8L3 21l1.2-4.5A9 9 0 1 1 21 12Z" />
              </span>
              <h1>Assistente</h1>
              <p className="muted">
                Pergunte sobre seus agentes, peça gráficos ou diga o que quer fazer. As mudanças aparecem como formulários
                para você revisar e confirmar.
              </p>
              <div className="chat-suggestions">
                {suggestions.map((s) => (
                  <button key={s} type="button" className="secondary" onClick={() => void send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => {
            if (m.role === "user") return <div key={m.id} className="bubble user">{m.text}</div>;
            if (m.role === "event") {
              return (
                <div key={m.id} className="chat-event">
                  ✓ <EventText text={m.text} />
                </div>
              );
            }
            return (
              <div key={m.id} className="bubble assistant">
                {/* A conversa entre os agentes fica fechada acima; o resultado vem logo abaixo, sem rolar. */}
                {m.trace && <NegotiationTrace entries={m.trace} me={me?.handle ?? null} />}
                <div className="prose">
                  <Markdown remarkPlugins={[remarkGfm]}>{m.reply.message}</Markdown>
                </div>
                {m.reply.ui.map((c, i) => {
                  const ref = `${m.id}:${i}`;
                  return (
                    <div key={ref} className="chat-block">
                      <UiBlock
                        component={c}
                        ctx={{
                          recordEvent: recordEvent(ref),
                          callAgent: callAgent(ref),
                          done: doneByRef.get(ref) ?? null,
                          currencyFor: (agent) => traceCurrency(m.trace, agent),
                          send: (text) => void send(text),
                          answered: sending || messages.indexOf(m) < messages.length - 1,
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            );
          })}

          {showExamples && <ExamplesBlock onPick={(p) => void send(p)} onClose={() => setShowExamples(false)} />}

          {awaiting && (
            <div className="bubble assistant pending">
              <span className="typing" aria-label="Assistente trabalhando">
                <i />
                <i />
                <i />
              </span>
              <span className="chat-step current">Seu agente ainda está trabalhando nesta mensagem…</span>
            </div>
          )}
          {sending && (
            <div className="bubble assistant pending">
              <span className="typing" aria-label="Assistente trabalhando">
                <i />
                <i />
                <i />
              </span>
              {progress.map((p, i) => (
                <span key={i} className={`chat-step${i === progress.length - 1 ? " current" : ""}`}>
                  {p}
                </span>
              ))}
              <NegotiationTrace entries={liveTrace} me={me?.handle ?? null} live />
            </div>
          )}
          {error && <div className="alert warn">{error}</div>}
          <div ref={endRef} />
        </div>

        <form
          className="chat-input"
          onSubmit={(e) => {
            e.preventDefault();
            void send(text);
          }}
        >
          <textarea
            rows={1}
            placeholder={`Pergunte ou peça algo… (${EXAMPLES_COMMAND} para ver exemplos)`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(text);
              }
            }}
            disabled={sending}
          />
          <button type="submit" disabled={sending || !text.trim()} aria-label="Enviar">
            <Icon d="M5 12h14M13 6l6 6-6 6" />
          </button>
        </form>
      </section>
    </div>
  );
}
