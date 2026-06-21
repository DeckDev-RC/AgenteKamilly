export type CliArgs = {
  request: string;
  runtimeModeOverride?: "dry-run" | "live";
  params?: Record<string, unknown>;
  approvalText?: string;
  outputMode?: "json" | "operator";
  summaryOperationId?: string;
  agentMode?: boolean;
  agentSessionId?: string;
  modelSmoke?: boolean;
  verbose?: boolean;
};

export function parseCliArgs(argv: string[]): CliArgs {
  const requestParts: string[] = [];
  let runtimeModeOverride: "dry-run" | "live" = "dry-run";
  let params: Record<string, unknown> | undefined;
  let approvalText: string | undefined;
  let outputMode: "json" | "operator" | undefined;
  let summaryOperationId: string | undefined;
  let agentSessionId: string | undefined;
  let agentMode = false;
  let modelSmoke = false;
  let verbose = false;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--agent") {
      agentMode = true;
      continue;
    }
    if (arg === "--session") {
      agentSessionId = argv[++index];
      if (!agentSessionId) throw new Error("Missing value for --session");
      continue;
    }
    if (arg === "--model-smoke") {
      modelSmoke = true;
      continue;
    }
    if (arg === "--live") {
      runtimeModeOverride = "live";
      continue;
    }
    if (arg === "--dry-run") {
      runtimeModeOverride = "dry-run";
      continue;
    }
    if (arg === "--params") {
      const raw = argv[++index];
      params = raw ? parseJsonObject(raw, "--params") : undefined;
      continue;
    }
    if (arg === "--approval") {
      approvalText = argv[++index];
      continue;
    }
    if (arg === "--summary") {
      summaryOperationId = argv[++index];
      if (!summaryOperationId) throw new Error("Missing value for --summary");
      continue;
    }
    if (arg === "--json") {
      outputMode = "json";
      continue;
    }
    if (arg === "--operator") {
      outputMode = "operator";
      continue;
    }
    if (arg === "--output") {
      const raw = argv[++index];
      if (raw !== "json" && raw !== "operator") {
        throw new Error("--output must be json or operator.");
      }
      outputMode = raw;
      continue;
    }
    if (arg === "--verbose") {
      verbose = true;
      continue;
    }
    requestParts.push(arg);
  }

  return withoutUndefined({
    request: requestParts.join(" ").trim(),
    runtimeModeOverride,
    params,
    approvalText,
    outputMode,
    summaryOperationId,
    agentSessionId,
    agentMode,
    modelSmoke,
    verbose
  });
}

function parseJsonObject(raw: string, flag: string): Record<string, unknown> {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${flag} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)
  ) as T;
}
