import type { AgentResultView } from "../../server/api-types.js";

export type InlineFormFieldType =
  | "text"
  | "email"
  | "tel"
  | "money"
  | "date"
  | "textarea"
  | "select"
  | "charge_picklist"
  | "document"
  | "cep";

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
  /** Dispara ação interativa ao sair de um campo (ex.: buscar CNPJ na Receita). */
  fieldBlurActions?: Record<string, string>;
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
  contaazul_update_due_date: {
    title: "Alterar vencimento",
    submitLabel: "Preparar alteração",
    flow: "contaazul_update_due_date",
    action: "submit_contaazul_update_details",
    fieldChangeActions: {
      customerId: "load_contaazul_statements",
      pendingOnly: "load_contaazul_statements"
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
        name: "pendingOnly",
        label: "Situação",
        type: "select",
        placeholder: "Filtrar por situação...",
        required: true,
        wide: true,
        hint: "Pendentes = cobranças em aberto; Todas inclui liquidadas."
      },
      {
        name: "chargeIds",
        label: "Cobranças",
        type: "charge_picklist",
        required: true,
        wide: true,
        multiple: true,
        emptyMessage: "Nenhuma cobrança encontrada para este cliente.",
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
        name: "chargeIds",
        label: "Cobrança",
        type: "charge_picklist",
        required: true,
        wide: true,
        multiple: false,
        emptyMessage: "Nenhuma cobrança boleto para este cliente.",
        hint: "Todas as cobranças boleto do cliente (pendentes, recebidas, vencidas etc.)."
      }
    ]
  },
  contaazul_create_customer_details: {
    title: "Cadastrar cliente",
    submitLabel: "Preparar cadastro",
    flow: "contaazul_create_customer",
    action: "submit_create_customer_details",
    fieldChangeActions: {
      personType: "lookup_cnpj"
    },
    fieldBlurActions: {
      document: "lookup_cnpj"
    },
    fields: [
      {
        name: "personType",
        label: "Tipo de pessoa",
        type: "select",
        placeholder: "Selecione...",
        required: true,
        wide: true
      },
      {
        name: "document",
        label: "CPF ou CNPJ",
        type: "document",
        placeholder: "000.000.000-00 ou 00.000.000/0000-00",
        required: true,
        wide: true,
        hint: "Para PJ, buscamos razão social e endereço na Receita Federal ao sair do campo."
      },
      {
        name: "name",
        label: "Nome ou nome fantasia",
        type: "text",
        placeholder: "Nome completo ou fantasia",
        required: true,
        wide: true
      },
      {
        name: "companyName",
        label: "Razão social",
        type: "text",
        placeholder: "Somente para pessoa jurídica",
        required: false,
        wide: true,
        hint: "Opcional se o CNPJ já trouxer a razão social."
      },
      {
        name: "email",
        label: "E-mail",
        type: "email",
        placeholder: "cliente@empresa.com.br",
        required: false
      },
      {
        name: "cellPhone",
        label: "Celular",
        type: "tel",
        placeholder: "DDD + número",
        required: false
      },
      {
        name: "billingEmail",
        label: "E-mail de cobrança",
        type: "email",
        placeholder: "cobranca@empresa.com.br",
        required: false
      },
      {
        name: "billingPhone",
        label: "Telefone de cobrança",
        type: "tel",
        placeholder: "DDD + número",
        required: true
      },
      {
        name: "zipcode",
        label: "CEP",
        type: "cep",
        placeholder: "00000-000",
        required: false
      },
      {
        name: "numberAddress",
        label: "Número do endereço",
        type: "text",
        placeholder: "Ex.: 100",
        required: false
      }
    ]
  }
};

export function inferInlineForm(result: AgentResultView): InlineFormDefinition | null {
  if (!result.formId) return null;
  return INLINE_FORMS[result.formId] ?? null;
}
