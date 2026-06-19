# Fixture Sanitization Rules

Fixtures must be safe to commit, inspect, and send to an agent.

Do not store:

- cookies
- `Authorization`, `x-authorization`, `auth-token`, `accountancy-token`, or `redirect_token`
- passwords, login names, or session ids
- full emails
- full phone numbers
- CPF/CNPJ values
- complete customer names when they identify a real person/company
- complete `state.json`
- live boleto PDFs

Allowed fixture patterns:

- `customerId: "cus_test_001"`
- `chargeId: "pay_test_001"`
- `relationId: "rel_test_001"`
- `email: "cliente@example.test"`
- `document: "00000000000"` only when the parser needs document shape
- fake names like `"Cliente Exemplo Ltda"`
- shortened HTML snippets containing only parser-relevant elements
- JSON with irrelevant real provider fields removed

Before adding a fixture:

1. Run the fixture through `redact` or manually remove sensitive values.
2. Prefer the smallest HTML/JSON snippet that reproduces parser behavior.
3. Confirm no token-like or cookie-like strings remain.
4. Add a parser test that explains why the fixture exists.
