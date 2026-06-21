import { createToolRegistry, type ToolRegistry } from "../core/tool-registry.js";

const SAFE_AGENT_TOOL_NAMES = new Set([
  "asaas.create_boleto_charge_workflow",
  "contaazul.create_service_sale_boleto_workflow",
  "contaazul.acknowledge_orphan_cleanup"
]);

export function createSafeWorkflowRegistry(registry: ToolRegistry): ToolRegistry {
  const safe = createToolRegistry();
  for (const tool of registry.list()) {
    if (!SAFE_AGENT_TOOL_NAMES.has(tool.name)) continue;
    safe.register(tool);
  }
  return safe;
}
