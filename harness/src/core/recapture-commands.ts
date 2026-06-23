/** Comandos de renovação de sessão (perfil persistente + storageState). */
export const RECAPTURE_COMMANDS = {
  asaas: "node renew-session.cjs asaas",
  contaazul: "node renew-session.cjs contaazul"
} as const;

export type RecaptureProvider = keyof typeof RECAPTURE_COMMANDS;
