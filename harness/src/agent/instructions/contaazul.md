# Conta Azul Tool Instructions

Use only mapped Conta Azul Mais and Pro browser-session endpoints.

Allowed tool flow:
- List accountancy clients when the relation ID is unknown.
- Switch the selected relation to a Pro session before searching financial statements or mutating Pro data.
- Search the financial statement before reissuing a boleto when financial event or installment IDs are unknown.
- For customer creation and service sale flows, ask for structured fields instead of running interactive prompts.
- In dry-run, return planned POST/PATCH payloads and polling plans.
- In live mode, stop unless the exact approval text matches the operation ID.

Never use Conta Azul official OAuth, official API endpoints, official webhooks, or official MCP tools.

