process.env.RUNTIME_MODE ??= "dry-run";
process.env.ALLOW_LIVE_MUTATIONS ??= "false";

const originalFetch = globalThis.fetch;

globalThis.fetch = async (input, init) => {
  const url = extractUrl(input);
  if (isProviderUrl(url)) {
    throw new Error(`Live provider network blocked in tests: ${url}`);
  }
  return originalFetch(input, init);
};

function extractUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function isProviderUrl(url: string): boolean {
  return (
    url.includes("asaas.com") ||
    url.includes("contaazul.com")
  );
}
