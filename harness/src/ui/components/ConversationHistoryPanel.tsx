import { MessageSquarePlus, Trash2 } from "lucide-react";
import type { ReactElement } from "react";

import type { ConversationSummaryView } from "../../server/api-types.js";

function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function ConversationHistoryPanel(props: {
  activeId?: string;
  className?: string;
  conversations: ConversationSummaryView[];
  loading?: boolean;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onSelect: (id: string) => void;
}): ReactElement {
  return (
    <aside
      aria-label="Histórico de conversas"
      className={["conversation-history", props.className].filter(Boolean).join(" ")}
    >
      <div className="conversation-history__header">
        <strong>Histórico</strong>
        <button
          className="conversation-history__new"
          onClick={props.onCreate}
          title="Nova conversa"
          type="button"
        >
          <MessageSquarePlus aria-hidden="true" size={16} />
        </button>
      </div>

      <div className="conversation-history__list">
        {props.loading ? <p className="conversation-history__empty">Carregando…</p> : null}
        {!props.loading && props.conversations.length === 0 ? (
          <p className="conversation-history__empty">Nenhuma conversa salva ainda.</p>
        ) : null}
        {props.conversations.map((conversation) => {
          const active = conversation.id === props.activeId;
          return (
            <div
              className={`conversation-history__item ${active ? "conversation-history__item--active" : ""}`}
              key={conversation.id}
            >
              <button
                className="conversation-history__select"
                onClick={() => props.onSelect(conversation.id)}
                type="button"
              >
                <span className="conversation-history__title">{conversation.title}</span>
                <span className="conversation-history__preview">
                  {conversation.preview || "Sem mensagens"}
                </span>
                <span className="conversation-history__meta">
                  {formatRelativeTime(conversation.updatedAt)} · {conversation.messageCount} msg
                </span>
              </button>
              <button
                aria-label={`Excluir conversa ${conversation.title}`}
                className="conversation-history__delete"
                onClick={() => props.onDelete(conversation.id)}
                type="button"
              >
                <Trash2 aria-hidden="true" size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
