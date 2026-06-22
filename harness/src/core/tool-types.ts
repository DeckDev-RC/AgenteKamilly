export type Provider = "asaas" | "contaazul";

export type RuntimeMode = "dry-run" | "live";

export type OperationStatus =
  | "planned"
  | "approved"
  | "running"
  | "succeeded"
  | "failed"
  | "blocked";

export type ArtifactKind = "json" | "pdf" | "html" | "png" | "txt";

export type Artifact = {
  kind: ArtifactKind;
  path: string;
  label: string;
  sha256?: string;
};

export type ToolReceipt<T = unknown> = {
  operationId: string;
  provider: Provider;
  toolName: string;
  status: OperationStatus;
  dryRun: boolean;
  summary: string;
  data?: T;
  artifacts: Artifact[];
  warnings: string[];
  candidates?: string[];
  fieldName?: string;
};

export type ApprovalPreview = {
  operationId: string;
  provider: Provider;
  toolName: string;
  action: "create" | "update" | "delete" | "cancel" | "send" | "download";
  target: {
    customerId?: string;
    customerName?: string;
    chargeId?: string;
    saleId?: string;
    installmentId?: string;
  };
  changes: Array<{ field: string; from?: string; to: string }>;
  irreversible: boolean;
  rollbackNote: string;
};

export type CustomerMatch = {
  id: string;
  name: string;
  document?: string;
  email?: string;
  phone?: string;
  providerRawRef?: string;
};

export type PendingCharge = {
  id: string;
  customerId: string;
  customerName?: string;
  valueBr: string;
  dueDateBr: string;
  status: string;
  description?: string;
};

export type ChargeLinks = {
  chargeId: string;
  boletoUrl?: string;
  invoiceUrl?: string;
  externalToken?: string;
};

export type AccountancyClient = {
  relationId: string;
  tenantId: string | number;
  name: string;
  document?: string;
  active: boolean;
};

export type FinancialStatementItem = {
  id: string;
  financialEventId: string;
  description: string;
  value: number;
  dueDateIso?: string;
  customerName?: string;
  status?: string;
  installmentId?: string;
};

export type SaleCustomerMatch = {
  id: string;
  name: string;
  document?: string;
  email?: string;
  billingEmail?: string;
  billingPhone?: string;
};
