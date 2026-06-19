# Mapped Session Endpoint Inventory

This harness intentionally uses only the browser-session HTTP routes already mapped by the local scripts.
Do not add official provider APIs, official webhooks, OAuth integrations, or official provider MCPs.

## Auth Sources

| Provider | Session source | Notes |
| --- | --- | --- |
| Asaas | `ASAAS_ENV_PATH`, default `../.env` from the harness process cwd, with `COOKIE_STRING` | Cookies must never appear in logs, approval previews, artifacts, prompts, or fixtures. |
| Conta Azul | `CONTAAZUL_ENV_PATH`, default `../contaazul/.env`, and `CONTAAZUL_STATE_PATH`, default `../contaazul/state.json` | Conta Azul Mais cookies are used to derive a Conta Azul Pro `auth-token` through mapped session-switch endpoints. |

## Asaas

Source references:
- `../asaas_clientes.js`
- `../cobrancas/asaas_cobrancas.js`
- `../cobrancas/interativo.js`

| Method | URL or path | Purpose | Source function | Auth | Mutates state | Requires approval | Response/parsing dependency | Artifact |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `https://www.asaas.com/customerAccount/loadTableContent?offset=<offset>&max=<max>` | List/search customers and refresh local cache. | `listarClientes`, `obterClientes` | Asaas cookie | No | No | HTML table/rows with customer id and fields. | Optional sanitized JSON cache/export. |
| GET | `https://www.asaas.com/customerAccount/show/<id>?edit=true` | Read customer edit form/details before update. | `consultarCliente` | Asaas cookie | No | No | HTML form fields/hidden inputs. | Optional HTML snapshot if parser breaks. |
| POST | `https://www.asaas.com/customerAccount/save` | Create customer. | `criarCliente` | Asaas cookie | Yes | Yes | JSON or HTML response depending provider behavior. | Ledger receipt plus redacted request summary. |
| POST | `https://www.asaas.com/customerAccount/save` | Edit customer. | `editarCliente` | Asaas cookie | Yes | Yes | Requires current customer form fields to avoid dropping values. | Ledger receipt plus redacted request summary. |
| POST | `https://www.asaas.com/customerAccount/deleteAjax` | Delete customer. | `deletarCliente` | Asaas cookie | Yes | Yes | JSON status/body. Treat as irreversible unless provider exposes undo. | Ledger receipt. |
| GET | `https://www.asaas.com/paymentList/loadTableContent?offset=<offset>&max=<max>` | List charges. | `listarCobrancas` | Asaas cookie | No | No | HTML table/rows. | Optional sanitized JSON export. |
| GET | `https://www.asaas.com/paymentList/loadTableContent?customerAccountId=<id>&offset=<offset>&max=<max>` | List charges for a customer, including pending charges for the interactive flow. | `listarCobrancas`, `obterCobrancasPendentes` | Asaas cookie | No | No | HTML table/rows; pending status text is parsed from table content. | Optional sanitized JSON export. |
| GET | `https://www.asaas.com/payment/show/<id>` | Read charge detail and extract boleto/fatura links. | `consultarCobranca`, `obterLinksBoleto`, `mapearFluxoCobranca` | Asaas cookie | No | No | HTML detail page, links, hidden values, available actions. | Optional HTML snapshot on parser failure. |
| GET | `https://www.asaas.com/payment/loadInterestFineDiscount/<id>` | Read interest/fine/discount settings. | `consultarJurosMulta` | Asaas cookie | No | No | JSON or HTML fragment. | None. |
| POST | `https://www.asaas.com/payment/update` | Update charge fields, including due date. | `salvarVencimento`, charge edit flow | Asaas cookie | Yes | Yes | Form-url-encoded payload; provider response text/JSON. | Ledger receipt. |
| POST | `https://www.asaas.com/payment/save` | Create boleto charge. | `criarCobranca`, `criarCobrancaParaCliente` | Asaas cookie | Yes | Yes | JSON with payment id and `externalTokens`. | Receipt plus planned boleto/fatura links. |
| POST | `https://www.asaas.com/payment/updateInterestFineDiscount/<id>` | Update interest/fine/discount settings. | `atualizarJurosMulta` | Asaas cookie | Yes | Yes | Form-url-encoded payload; response status/body. | Ledger receipt. |
| POST | `https://www.asaas.com/payment/deleteAjax` | Delete charge. | `deletarCobranca` | Asaas cookie | Yes | Yes | JSON status/body. Treat as irreversible unless provider exposes undo. | Ledger receipt. |
| POST | `https://www.asaas.com/payment/confirmReceivedInCash` | Confirm cash receipt. | `confirmarRecebimento` | Asaas cookie | Yes | Yes | Form-url-encoded payload; response status/body. | Ledger receipt. |
| GET | `https://www.asaas.com/b/pdf/<externalToken>` | Download boleto PDF. | `baixarPDFBoleto` | Asaas cookie | No provider state change, but stores local file | No for download only; approval required if paired with create/update | PDF bytes. | `artifacts/asaas/<operationId>/*.pdf`. |
| GET | `https://www.asaas.com/i/<externalToken>` | User-facing fatura page link derived from charge response/detail. | Link construction in charge flows | Asaas cookie/browser session may be required | No | No | URL derived from `externalTokens`. | Link in receipt. |

Discovery-only Asaas routes seen in probes:
- `https://www.asaas.com/payment/create`
- `https://www.asaas.com/customerAccount/show/<customerId>`
- `https://www.asaas.com/dashboard/index`

These are allowed for remapping/debugging, not as production business tools unless promoted with tests, redaction, and approval rules.

## Conta Azul

Source references:
- `../contaazul/capture.js`
- `../contaazul/request.js`
- `../contaazul/interativo.js`
- `../contaazul/map_new_sale_flow.js`

| Method | URL or path | Purpose | Source function | Auth | Mutates state | Requires approval | Response/parsing dependency | Artifact |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET | `https://mais.contaazul.com/#/login` | Manual login/session capture with Playwright. | `capture.js` | Browser login | No | No | Browser storage/cookies. | `contaazul/state.json`, never copied to fixtures. |
| GET | `https://services.contaazul.com/camais-acc-customers/v2/customers?search=&page=1&pageSize=150&tabFilter=ALL` | List accountancy clients in Conta Azul Mais. | `obterClientes` | Conta Azul Mais cookies and `auth-token-accountancy` | No | No | JSON customer list. | Optional sanitized JSON fixture. |
| GET | `https://accountancy.contaazul.com/rest/relation/<relationId>/login?isCaMaisPlan=false` | Switch relation and obtain redirect flow into Pro. | `obterAuthTokenClienteHTTP` | Conta Azul Mais cookies and accountancy token | No business mutation, but changes session context | No; block if relation ambiguous | HTTP redirect/302 and cookies/location. | Ledger session-switch receipt with redacted tokens. |
| GET | `https://app.contaazul.com/rest/login/heimdall` | Complete session switch and obtain Pro `auth-token`. | `obterAuthTokenClienteHTTP` | Redirect token/session cookies | No business mutation | No | HTTP redirect/303 and auth token cookie/header. | Ledger session-switch receipt with redacted tokens. |
| POST | `https://services.contaazul.com/finance-pro-reader/v1/financial-statement-view?page=<page>&page_size=<pageSize>` | Search/list financial statement entries. | `obterMovimentacoes` | Pro `x-authorization` | No | No | JSON `items` with pagination. | Optional sanitized JSON fixture. |
| GET | `https://services.contaazul.com/finance-pro/v1/financial-events/<eventId>` | Load financial event details and installments. | `buscarDetalhesLancamento` | Pro `x-authorization` | No | No | JSON event, payment condition, installments, charge requests. | Optional sanitized JSON fixture. |
| POST | `https://services.contaazul.com/finance-pro/v1/charge-requests/batch-cancel` | Cancel existing charge requests before reissue. | `cancelarCobrancaExistente` | Pro `x-authorization` | Yes | Yes | JSON/204 response. | Ledger receipt. |
| PATCH | `https://services.contaazul.com/finance-pro/v1/installments/<installmentId>` | Update installment due date/expected payment date. | `alterarVencimento` | Pro `x-authorization` | Yes | Yes | JSON installment response; requires version. | Ledger receipt. |
| GET | `https://services.contaazul.com/contaazul-bff/person-registration/v1/persons/<personId>/billing-contact` | Read billing contact email/phones. | `buscarEmailCobranca` | Pro `x-authorization` | No | No | JSON contact fields. | Optional sanitized JSON fixture. |
| POST | `https://services.contaazul.com/finance-pro/v2/charge-requests/batch-create` | Create/reissue boleto charge request. | `emitirBoleto`, new sale flow | Pro `x-authorization` | Yes | Yes | JSON charge request ids and metadata. | Ledger receipt and boleto polling plan. |
| GET | `https://services.contaazul.com/contaazul-bff/finance/v1/financial-events/<eventId>/summary` | Poll for boleto URL after charge creation. | `obterSummary`, `aguardarUrlCobranca` | Pro `x-authorization` | No | No | JSON summary with installments and charge request URLs. | Link in receipt. |
| POST | `https://services.contaazul.com/finance-pro-reports/v3/aggregate-pdfs-by-customer` | Download aggregated boleto PDF. | `downloadBoleto` | Pro `x-authorization` | No provider state change, but stores local file | No for download only; approval required if paired with create/update/send | PDF bytes. | `artifacts/contaazul/<operationId>/*.pdf`. |
| GET | `https://services.contaazul.com/contaazul-bff/account/v1/company-info/<cnpj>` | Prefill company/customer data by CNPJ. | `buscarCnpjInfo` | Pro `x-authorization` | No | No | JSON company data. | Optional sanitized JSON fixture. |
| GET | `https://app.contaazul.com/buscaCep.action?cep=<cep>` | Prefill address by CEP. | `buscarCepInfo` | Conta Azul app cookies | No | No | JSON address data. | Optional sanitized JSON fixture. |
| POST | `https://services.contaazul.com/contaazul-bff/person-registration/v1/persons` | Create customer/person. | `salvarNovoCliente` | Pro `x-authorization` | Yes | Yes | JSON person response. | Ledger receipt. |
| GET | `https://services.contaazul.com/contaazul-bff/person-registration/v2/persons?...` | Search customer for sale flow. | `buscarClientesVenda` | Pro `x-authorization` | No | No | JSON `items`. | Optional sanitized JSON fixture. |
| GET | `https://services.contaazul.com/app/financialCategory/autocomplete?...` | Search sales revenue category. | `buscarCategoriasVenda` | Pro `x-authorization` | No | No | JSON `data`. | Optional sanitized JSON fixture. |
| GET | `https://services.contaazul.com/inventory/v1/products?...` | Search provided service items. | `buscarItemsVenda` | Pro `x-authorization` | No | No | JSON `items`. | Optional sanitized JSON fixture. |
| POST | `https://services.contaazul.com/invoice-tax-management/v1/calculate-taxes` | Calculate taxes for a sale payload. | `calcularImpostosVenda` | Pro `x-authorization` | No business mutation | No | JSON tax calculation. | Optional sanitized JSON fixture. |
| GET | `https://services.contaazul.com/contaazul-bff/sale/v1/sales-operation-natures` | List sales operation natures. | `obterNaturesOperacao` | Pro `x-authorization` | No | No | JSON `items`. | Optional sanitized JSON fixture. |
| GET | `https://services.contaazul.com/app/v1/negotiations/next-number` | Get next sale number. | `obterProximoNumeroVenda` | Pro `x-authorization` | No | No | JSON `data`. | Optional sanitized JSON fixture. |
| POST | `https://services.contaazul.com/app/v1/sales/` | Create service sale. | `criarVendaServico` | Pro `x-authorization` | Yes | Yes | JSON sale response. | Ledger receipt. |
| GET | `https://services.contaazul.com/finance-pro/v1/financial-events?reference_id=<saleId>` | Find financial event generated by sale. | `obterEventoFinanceiroPorRef` | Pro `x-authorization` | No | No | JSON `items`; may require polling. | Optional sanitized JSON fixture. |
| GET | `https://services.contaazul.com/contaazul-bff/person-registration/v1/persons/<personUuid>` | Read person details after sale/customer selection. | `obterDetalhesPessoa` | Pro `x-authorization` | No | No | JSON person details. | Optional sanitized JSON fixture. |
| POST | `https://services.contaazul.com/finance-pro/v1/charge-notifications` | Send charge notification. | `enviarNotificacaoCobranca` | Pro `x-authorization` | Yes | Yes | JSON/201 response. | Ledger receipt. |
| GET | `https://services.contaazul.com/contaazul-bff/account/v1/company-details-edit` | Read company profile defaults. | `obterEmpresaDetails` | Pro `x-authorization` | No | No | JSON company details. | Optional sanitized JSON fixture. |

Discovery-only Conta Azul routes/scripts:
- `contaazul/map_new_sale_flow.js`
- `contaazul/prepare_mcp_injection.js`
- `contaazul/trace_redirect.js`
- `contaazul/test_session_switch.js`
- `contaazul/test_more_filters.js`

These are only for mapping, diagnostics, or session inspection. They are not registered agent tools unless promoted through the same schemas, tests, ledger, redaction, and approval gates.

## Promotion Rule For New Endpoints

Before any mapped endpoint becomes a harness tool:

1. Add it to this inventory.
2. Mark whether it mutates provider state.
3. Add input and output schemas.
4. Add a dry-run path for mutations.
5. Add redaction coverage for all request and response fields.
6. Add a sanitized fixture or a deterministic unit test.
7. Register it only through the private local tool registry.
