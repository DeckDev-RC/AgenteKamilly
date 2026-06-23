import type { AgentResultView } from "../../server/api-types.js";

export type InlineFormFieldType =
  | "text"
  | "email"
  | "tel"
  | "money"
  | "date"
  | "textarea"
  | "select"
  | "charge_picklist";

export type InlineFormField = {
  name: string;
  label: string;
  type: InlineFormFieldType;
  placeholder?: string;
  required?: boolean;
  hint?: string;
  wide?: boolean;
  multiple?: boolean;
  emptyMessage?: string;
};

export type InlineFormDefinition = {
  title: string;
  submitLabel: string;
  flow: string;
  action: string;
  fields: InlineFormField[];
  /** Dispara ação interativa ao mudar um campo select (ex.: carregar cobranças ao escolher cliente). */
  fieldChangeActions?: Record<string, string>;
};

export const INLINE_FORMS: Record<string, InlineFormDefinition> = {
  contaazul_service_sale_details: {
    title: "Dados da cobrança",
    submitLabel: "Preparar boleto",
    flow: "contaazul_service_sale_boleto",
    action: "submit_sale_details",
    fields: [
      {
        name: "categoryId",
        label: "Categoria financeira",
        type: "select",
        placeholder: "Pesquisar categoria...",
        required: true
      },
      {
        name: "itemId",
        label: "Item de serviço",
        type: "select",
        placeholder: "Pesquisar item...",
        required: true
      },
      {
        name: "serviceDescription",
        label: "Descrição do serviço",
        type: "textarea",
        placeholder: "Ex.: Honorário contábil — referente a junho/2026",
        required: true
      },
      {
        name: "unitValueBr",
        label: "Valor",
        type: "money",
        placeholder: "10,00",
        required: true
      },
      {
        name: "dueDateBr",
        label: "Vencimento",
        type: "date",
        placeholder: "DD/MM/AAAA",
        required: true
      },
      {
        name: "notification.phone",
        label: "Celular do cliente",
        type: "tel",
        placeholder: "DDD + número",
        required: true,
        hint: "Usado no envio do boleto por SMS/WhatsApp."
      },
      {
        name: "notification.email",
        label: "E-mail de cobrança",
        type: "email",
        placeholder: "cliente@empresa.com.br",
        required: true
      },
      {
        name: "notification.replyTo",
        label: "E-mail de contato (opcional)",
        type: "email",
        placeholder: "Deixe em branco para usar o padrão do escritório",
        required: false
      }
    ]
  },
  asaas_boleto_details: {
    title: "Nova cobrança Asaas",
    submitLabel: "Preparar boleto",
    flow: "asaas_boleto_charge",
    action: "submit_asaas_boleto_details",
    fields: [
      {
        name: "customerId",
        label: "Cliente",
        type: "select",
        placeholder: "Pesquisar cliente...",
        required: true,
        wide: true
      },
      {
        name: "valueBr",
        label: "Valor",
        type: "money",
        placeholder: "10,00",
        required: true
      },
      {
        name: "dueDateBr",
        label: "Vencimento",
        type: "date",
        placeholder: "DD/MM/AAAA",
        required: true
      },
      {
        name: "description",
        label: "Descrição",
        type: "textarea",
        placeholder: "Ex.: Mensalidade de serviços — referente a junho/2026",
        required: true,
        wide: true
      }
    ]
  },
  asaas_update_due_date: {
    title: "Alterar vencimento",
    submitLabel: "Preparar alteração",
    flow: "asaas_update_charge_due_date",
    action: "submit_asaas_update_details",
    fieldChangeActions: {
      customerId: "load_asaas_charges"
    },
    fields: [
      {
        name: "customerId",
        label: "Cliente",
        type: "select",
        placeholder: "Pesquisar cliente...",
        required: true,
        wide: true
      },
      {
        name: "chargeIds",
        label: "Cobranças pendentes",
        type: "charge_picklist",
        required: true,
        wide: true,
        multiple: true,
        emptyMessage: "Nenhuma cobrança pendente para este cliente.",
        hint: "Marque uma ou mais cobranças para alterar o vencimento."
      },
      {
        name: "dueDateBr",
        label: "Novo vencimento",
        type: "date",
        placeholder: "DD/MM/AAAA",
        required: true,
        wide: true
      }
    ]
  },
  asaas_download_boleto: {
    title: "Baixar boleto Asaas",
    submitLabel: "Baixar PDF",
    flow: "asaas_download_boleto",
    action: "submit_asaas_download_boleto",
    fieldChangeActions: {
      customerId: "load_asaas_charges"
    },
    fields: [
      {
        name: "customerId",
        label: "Cliente",
        type: "select",
        placeholder: "Pesquisar cliente...",
        required: true,
        wide: true
      },
      {
        name: "chargeId",
        label: "Cobrança",
        type: "select",
        placeholder: "Selecione o cliente primeiro...",
        required: true,
        wide: true,
        hint: "Todas as cobranças boleto do cliente (pendentes, recebidas, vencidas etc.)."
      }
    ]
  }
};

export function inferInlineForm(result: AgentResultView): InlineFormDefinition | null {
  if (!result.formId) return null;
  return INLINE_FORMS[result.formId] ?? null;
}
