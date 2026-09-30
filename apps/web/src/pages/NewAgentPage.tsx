import { useState } from "react";
import { useNavigate } from "react-router";
import { createAgentSchema, type OwnedAgent, type Visibility } from "@agentikal/shared";
import { VisibilityField } from "../components/VisibilityField.tsx";
import { api, issuesToMap, RequestError } from "../api.ts";
import { draftToInput, emptyDraft, VersionFields } from "../components/VersionForm.tsx";
import { TagsField } from "../components/TagsField.tsx";
import { HandleField } from "../components/HandleField.tsx";

export function NewAgentPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [summary, setSummary] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("unlisted");
  const [tags, setTags] = useState<string[]>([]);
  const [draft, setDraft] = useState(emptyDraft());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="app-page narrow-page">
      <div className="page-header">
        <div>
          <h1>Registrar agente</h1>
          <p className="muted">
            O ID é gerado automaticamente e nunca muda; o endereço @ é o nome pelo qual outros agentes o chamam. A primeira
            versão é publicada junto.
          </p>
        </div>
      </div>
      <form
        className="stack panel"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          setFormError(null);
          // Mesmo schema da API: erros aparecem sem ida ao servidor.
          const { input: firstVersion, toolsError } = draftToInput(draft);
          if (toolsError) return setErrors({ "firstVersion.tools": toolsError });
          const parsed = createAgentSchema.safeParse({
            name,
            handle: handle || undefined,
            summary,
            visibility,
            tags,
            firstVersion,
          });
          if (!parsed.success) {
            setErrors(issuesToMap(parsed.error.issues));
            return;
          }
          setErrors({});
          setBusy(true);
          try {
            const created = await api.post<OwnedAgent>("/api/agents", parsed.data);
            navigate(`/painel/${created.id}`);
          } catch (err) {
            if (err instanceof RequestError) {
              setErrors(issuesToMap(err.body.issues));
              setFormError(err.message);
            } else setFormError("Falha ao registrar");
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Nome
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
          {errors.name && <span className="error">{errors.name}</span>}
        </label>
        <HandleField value={handle} onChange={setHandle} name={name} error={errors.handle} />
        <label>
          Resumo
          <input value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={280} />
          <span className="hint">Uma linha; aparece em listagens e em previews de links. Pode ser editado depois.</span>
          {errors.summary && <span className="error">{errors.summary}</span>}
        </label>
        <TagsField value={tags} onChange={setTags} error={errors.tags} />
        <VisibilityField value={visibility} onChange={setVisibility} />
        <VersionFields value={draft} onChange={setDraft} errors={errors} errorPrefix="firstVersion" />
        {formError && <p className="error">{formError}</p>}
        <button type="submit" className="button" disabled={busy}>
          {busy ? "Registrando…" : "Registrar e publicar"}
        </button>
      </form>
    </div>
  );
}
