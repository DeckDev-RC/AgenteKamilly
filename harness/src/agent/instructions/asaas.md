# Asaas Tool Instructions

Use only mapped Asaas session endpoints under `https://www.asaas.com`.

Allowed tool flow:
- Search customers before creating or listing charges when the customer ID is unknown.
- List pending charges before editing a due date when the charge ID is unknown.
- Extract boleto/fatura links before attempting a PDF download when the external token is unknown.
- For create/update actions, require an approval preview and exact operation approval before live mode.

Never ask for or use Asaas official API keys, official webhooks, or official MCP tools.

