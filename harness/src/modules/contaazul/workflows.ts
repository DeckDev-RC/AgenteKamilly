import {
  ContaAzulCreateServiceSaleBoletoWorkflowParamsSchema,
  createContaAzulMutationTools,
  type ContaAzulCreateServiceSaleBoletoWorkflowParams,
  type ContaAzulMutationTools,
  type CreateContaAzulMutationToolsOptions
} from "./tools.js";

export { ContaAzulCreateServiceSaleBoletoWorkflowParamsSchema };
export type { ContaAzulCreateServiceSaleBoletoWorkflowParams };

export type ContaAzulWorkflowTools = Pick<
  ContaAzulMutationTools,
  "createServiceSaleBoletoWorkflow" | "createCustomerWorkflow"
>;

export function createContaAzulWorkflowTools(
  options: CreateContaAzulMutationToolsOptions
): ContaAzulWorkflowTools {
  const tools = createContaAzulMutationTools(options);
  return {
    createServiceSaleBoletoWorkflow: tools.createServiceSaleBoletoWorkflow,
    createCustomerWorkflow: tools.createCustomerWorkflow
  };
}
