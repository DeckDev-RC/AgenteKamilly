import { AlertTriangle, Cpu, FolderOpen, Save, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import type { FormEvent, ReactElement } from "react";

import type { AppSettingsView } from "../../server/api-types.js";
import { getAppSettings, updateAppSettings } from "../api.js";

export function SettingsScreen(): ReactElement {
  const [settings, setSettings] = useState<AppSettingsView | undefined>();
  const [allowLiveMutations, setAllowLiveMutations] = useState(false);
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [success, setSuccess] = useState<string | undefined>();

  useEffect(() => {
    void getAppSettings()
      .then((next) => {
        setSettings(next);
        setAllowLiveMutations(next.allowLiveMutations);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Falha ao carregar configurações.");
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(undefined);
    setSuccess(undefined);
    try {
      const response = await updateAppSettings({
        allowLiveMutations,
        ...(geminiApiKey.trim() ? { geminiApiKey: geminiApiKey.trim() } : {})
      });
      setSettings(response.settings);
      setAllowLiveMutations(response.settings.allowLiveMutations);
      setGeminiApiKey("");
      setSuccess("Configurações salvas no arquivo .env do aplicativo.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar configurações.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="screen">
      <div className="screen-header">
        <div>
          <p className="eyebrow">Configurações</p>
          <h1>Preferências do app</h1>
          <p className="screen-lead">
            Ajuste execução real e a chave da IA sem editar o arquivo manualmente.
          </p>
        </div>
      </div>

      {error ? <div className="notice notice--danger">{error}</div> : null}
      {success ? <div className="notice notice--success">{success}</div> : null}

      <form className="settings-form" onSubmit={(event) => void handleSubmit(event)}>
        <article className="settings-card">
          <div className="settings-card__head">
            <span className="settings-card__icon" aria-hidden="true">
              <ShieldCheck size={20} />
            </span>
            <div>
              <strong>Execução real</strong>
              <p>Permite aprovar e executar operações de verdade (não só dry-run).</p>
            </div>
          </div>
          <label className="settings-toggle">
            <input
              checked={allowLiveMutations}
              disabled={loading || saving}
              onChange={(event) => setAllowLiveMutations(event.target.checked)}
              type="checkbox"
            />
            <span>ALLOW_LIVE_MUTATIONS</span>
          </label>
          <p className="settings-hint">
            Mesmo habilitado, cada operação ainda exige aprovação explícita com{" "}
            <code>APROVAR &lt;operationId&gt;</code>.
          </p>
        </article>

        <article className="settings-card">
          <div className="settings-card__head">
            <span className="settings-card__icon settings-card__icon--model" aria-hidden="true">
              <Cpu size={20} />
            </span>
            <div>
              <strong>Chave Gemini</strong>
              <p>Necessária para pedidos fora dos fluxos guiados do assistente.</p>
            </div>
          </div>
          <label className="settings-field">
            <span>GEMINI_API_KEY</span>
            <input
              autoComplete="off"
              disabled={loading || saving}
              onChange={(event) => setGeminiApiKey(event.target.value)}
              placeholder={
                settings?.geminiApiKeyConfigured
                  ? `Configurada · termina em ${settings.geminiApiKeyHint ?? "****"}`
                  : "Cole sua chave da API Gemini"
              }
              spellCheck={false}
              type="password"
              value={geminiApiKey}
            />
          </label>
          <p className="settings-hint">
            Deixe em branco para manter a chave atual. A chave nunca é exibida por completo na
            interface.
          </p>
        </article>

        {settings?.envPath ? (
          <div className="settings-env-path">
            <FolderOpen aria-hidden="true" size={16} />
            <span>
              Arquivo: <code>{settings.envPath}</code>
            </span>
          </div>
        ) : null}

        {!allowLiveMutations ? (
          <div className="settings-warning">
            <AlertTriangle aria-hidden="true" size={16} />
            Com mutações desabilitadas, o app opera apenas em modo de simulação (dry-run).
          </div>
        ) : null}

        <button className="settings-save" disabled={loading || saving} type="submit">
          <Save aria-hidden="true" size={16} />
          {saving ? "Salvando…" : "Salvar configurações"}
        </button>
      </form>
    </section>
  );
}
