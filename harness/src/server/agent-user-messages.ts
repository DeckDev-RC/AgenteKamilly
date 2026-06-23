/**
 * Traduz erros internos do agente LLM em mensagens amigáveis para o operador.
 */
export function formatAgentBlockedMessage(reason?: string): string {
  const fallback =
    "Não consegui prosseguir com segurança. Escolha uma operação no menu ou descreva o pedido com mais detalhes (por exemplo: emitir boleto, criar cliente ou mudar vencimento).";

  if (!reason?.trim()) return fallback;

  const lower = reason.toLowerCase();

  if (
    lower.includes("agent plan schema") ||
    lower.includes("valid json matching the agent plan") ||
    lower.includes("too small: expected string")
  ) {
    return "Não consegui montar um plano seguro para esse pedido. Seja mais específico — por exemplo: «emitir boleto no Conta Azul», «criar cliente» ou «mudar vencimento no Asaas». Você também pode escolher uma operação no menu.";
  }

  if (
    lower.includes("model provider failed") ||
    lower.includes("unexpected token") ||
    lower.includes("gemini api")
  ) {
    return "O assistente inteligente não respondeu como esperado. Use uma das operações do menu ou reformule o pedido com a ação desejada.";
  }

  if (lower.includes("official provider apis") || lower.includes("outside this harness boundary")) {
    return "Esse tipo de integração não está disponível aqui. Use os fluxos guiados do Asaas ou Conta Azul.";
  }

  if (
    lower.includes("not registered") ||
    lower.includes("capabilities") ||
    lower.includes("unsupported")
  ) {
    return "Ainda não sei fazer essa operação. Escolha uma opção no menu ou descreva outra tarefa financeira.";
  }

  if (lower.includes("confirmar agente") || lower.includes("informe o pedido")) {
    return reason;
  }

  if (reason.length > 140 || /schema|zod|json|token|http\s\d{3}|stack/i.test(reason)) {
    return fallback;
  }

  return reason;
}
