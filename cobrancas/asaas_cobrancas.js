/**
 * ASAAS - Módulo de Cobranças
 * 
 * Gerencia cobranças do Asaas via HTTP requests autenticados.
 * 
 * Uso:
 *   node cobrancas/asaas_cobrancas.js listar                              - Lista todas as cobranças
 *   node cobrancas/asaas_cobrancas.js listar-cliente <clienteId>          - Lista cobranças de um cliente
 *   node cobrancas/asaas_cobrancas.js consultar <cobrancaId>              - Consulta detalhes de uma cobrança
 *   node cobrancas/asaas_cobrancas.js editar <cobrancaId> <campo> <valor> - Edita uma cobrança
 *   node cobrancas/asaas_cobrancas.js juros <cobrancaId>                  - Consulta juros/multa/desconto
 *   node cobrancas/asaas_cobrancas.js exportar [clienteId]                - Exporta cobranças para JSON
 *   node cobrancas/asaas_cobrancas.js deletar <cobrancaId>                - Deleta uma cobrança
 *   node cobrancas/asaas_cobrancas.js confirmar-recebimento <cobrancaId>  - Confirma recebimento em dinheiro
 *   node cobrancas/asaas_cobrancas.js mapear-fluxo <cobrancaId>           - Mapeia fluxo de edição e boleto (não destrutivo)
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const fs = require('fs');
const readline = require('readline');

const BASE_URL = 'https://www.asaas.com';

function getHeaders() {
    return {
        'Cookie': process.env.COOKIE_STRING,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': '*/*',
    };
}

function ask(query) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => rl.question(query, ans => { rl.close(); resolve(ans); }));
}

function decodeHTML(text) {
    return text
        .replace(/&#64;/g, '@')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\\\//g, '/');
}

const rateLimit = {
    remaining: 100,
    resetTime: 0
};

const originalFetch = globalThis.fetch;

async function fetchSafe(url, options = {}, retries = 3) {
    if (rateLimit.remaining <= 3) {
        const sleepMs = rateLimit.resetTime - Date.now();
        if (sleepMs > 0) {
            console.log(`\n[Rate Limit] Limite baixo (${rateLimit.remaining} restando). Pausando por ${Math.ceil(sleepMs / 1000)} segundos...`);
            await new Promise(resolve => setTimeout(resolve, sleepMs + 1000));
        }
    }

    const res = await originalFetch(url, options);

    const remaining = res.headers.get('ratelimit-remaining');
    const reset = res.headers.get('ratelimit-reset');
    if (remaining !== null) rateLimit.remaining = parseInt(remaining, 10);
    if (reset !== null) rateLimit.resetTime = Date.now() + parseInt(reset, 10) * 1000;

    if (res.status === 429 && retries > 0) {
        const resetSecs = parseInt(res.headers.get('ratelimit-reset') || '10', 10);
        const sleepMs = resetSecs * 1000 + 1000;
        console.warn(`\n[HTTP 429] Limite excedido. Aguardando ${sleepMs / 1000}s para tentar novamente (Tentativas restantes: ${retries})...`);
        await new Promise(resolve => setTimeout(resolve, sleepMs));
        return fetchSafe(url, options, retries - 1);
    }

    return res;
}

// Sobrescrever fetch global localmente para respeitar rate limits automaticamente
const fetch = fetchSafe;

// ============================================
// LISTAR COBRANÇAS (geral ou por cliente)
// ============================================
async function listarCobrancas(customerAccountId = null, offset = 0, max = 50) {
    let url = `${BASE_URL}/paymentList/loadTableContent?offset=${offset}&max=${max}`;
    if (customerAccountId) {
        url += `&customerAccountId=${customerAccountId}`;
    }

    const res = await fetch(url, { headers: getHeaders() });
    if (res.status !== 200) {
        console.error(`Erro ao listar cobranças: HTTP ${res.status}`);
        return [];
    }

    const json = await res.json();
    const content = json.content || '';

    // Extrair dados das cobranças do HTML retornado
    const rowRegex = /data-payment-id="(\d+)"[\s\S]*?data-billing-type="([^"]*)"[\s\S]*?<atlas-text ellipsis size="sm">\s*(.*?)\s*<\/atlas-text>[\s\S]*?<atlas-table-col>\s*<atlas-layout[^>]*>\s*(R\$\s*[\d.,]+)/g;

    const cobrancas = [];
    let match;
    while ((match = rowRegex.exec(content)) !== null) {
        cobrancas.push({
            id: match[1],
            tipo: match[2],
            cliente: decodeHTML(match[3].trim()),
            valor: match[4].trim(),
        });
    }

    // Extrair datas de vencimento e status separadamente
    const dateRegex = /data-payment-id="(\d+)"[\s\S]*?(\d{2}\/\d{2}(?:\/\d{4})?)/g;
    const dates = {};
    while ((match = dateRegex.exec(content)) !== null) {
        dates[match[1]] = match[2];
    }

    // Extrair descrição/assinatura
    const descRegex = /data-payment-id="(\d+)"[\s\S]*?<atlas-table-col>\s*([A-ZÀ-Ú\s]+(?:MENSAL|ANUAL|SERVIÇO|PRODUTO|HONORÁRIO)[A-ZÀ-Ú\s]*)\s*<\/atlas-table-col>/gi;
    const descs = {};
    while ((match = descRegex.exec(content)) !== null) {
        descs[match[1]] = match[2].trim();
    }

    // Extrair status via tooltip
    const statusRegex = /data-payment-id="(\d+)"[\s\S]*?data-original-title="([^"]+)"/g;
    const statuses = {};
    while ((match = statusRegex.exec(content)) !== null) {
        if (!statuses[match[1]]) {
            statuses[match[1]] = match[2];
        }
    }

    // Enriquecer dados
    for (const c of cobrancas) {
        c.vencimento = dates[c.id] || '';
        c.descricao = descs[c.id] || '';
        c.status = statuses[c.id] || '';
    }

    return cobrancas;
}

// ============================================
// CONSULTAR COBRANÇA POR ID
// ============================================
async function consultarCobranca(id) {
    const url = `${BASE_URL}/payment/show/${id}`;
    const res = await fetch(url, { headers: getHeaders() });

    if (res.status !== 200) {
        console.error(`Erro ao consultar cobrança ${id}: HTTP ${res.status}`);
        return null;
    }

    const html = await res.text();

    const cobranca = { id };
    const fieldsMap = {
        'value': 'Valor',
        'dueDate': 'Vencimento',
        'paymentDate': 'Data Pagamento',
        'dateCreated': 'Data Criação',
        'description': 'Descrição',
        'billingType': 'Tipo Cobrança',
        'status': 'Status',
        'sendNotification': 'Enviar Notificação',
        'interest.value': 'Juros (%)',
        'fine.value': 'Multa (R$)',
        'discount.value': 'Desconto (R$)',
        'discount.type': 'Tipo Desconto',
        'discount.dueDateLimitDays': 'Dias Limite Desconto',
        'externalReference': 'Referência Externa',
        'invoiceNumber': 'Número NF',
        'customerAccountId': 'ID Cliente',
        'options': 'Opções',
        'partialRelease': 'Liberação Parcial',
        'minValueReceivedInCash': 'Valor Mínimo Recebimento',
        'invoiceCreationPeriod': 'Período Criação NF',
    };

    for (const [field, label] of Object.entries(fieldsMap)) {
        const escapedField = field.replace('.', '\\.');
        const regex1 = new RegExp(`name=["']${escapedField}["'][^>]*?value=["']([^"']*)["']`, 'i');
        const regex2 = new RegExp(`value=["']([^"']*)["'][^>]*?name=["']${escapedField}["']`, 'i');
        const m = html.match(regex1) || html.match(regex2);
        if (m && m[1]) {
            cobranca[label] = decodeHTML(m[1]);
        }
    }

    // Extrair nome do cliente do HTML
    const clienteMatch = html.match(/customerAccount[^>]*>[\s\S]*?<[^>]*>([^<]+)</i);
    if (clienteMatch) {
        cobranca['Cliente'] = decodeHTML(clienteMatch[1].trim());
    }

    // Extrair URLs de ação disponíveis
    const acoes = [];
    if (html.includes('/payment/update')) acoes.push('editar');
    if (html.includes('/payment/deleteAjax')) acoes.push('deletar');
    if (html.includes('/payment/refund/')) acoes.push('reembolsar');
    if (html.includes('/payment/confirmReceivedInCash')) acoes.push('confirmar-recebimento');
    if (html.includes('/payment/undoReceivedInCash/')) acoes.push('desfazer-recebimento');
    if (html.includes('/payment/sendDueDateWarning')) acoes.push('enviar-lembrete');
    if (html.includes('/payment/updateInterestFineDiscount/')) acoes.push('editar-juros-multa');
    if (html.includes('/payment/sendByPostalService/')) acoes.push('enviar-correios');
    cobranca['Ações Disponíveis'] = acoes.join(', ');

    return cobranca;
}

// ============================================
// CONSULTAR JUROS/MULTA/DESCONTO
// ============================================
async function consultarJurosMulta(id) {
    const url = `${BASE_URL}/payment/loadInterestFineDiscount/${id}`;
    const res = await fetch(url, { headers: getHeaders() });
    if (res.status !== 200) {
        console.error(`Erro: HTTP ${res.status}`);
        return null;
    }
    const html = await res.text();

    const data = {};
    const fields = ['interest.value', 'interest.type', 'fine.value', 'fine.type', 'discount.value', 'discount.type', 'discount.dueDateLimitDays'];
    for (const field of fields) {
        const escaped = field.replace('.', '\\.');
        const regex = new RegExp(`name=["']${escaped}["'][^>]*value=["']([^"']*)["']`, 'i');
        const m = html.match(regex);
        if (m) data[field] = m[1];
    }

    return data;
}

// ============================================
// EDITAR COBRANÇA
// ============================================
async function editarCobranca(id, campo, valor) {
    const reverseMap = {
        'valor': 'value',
        'vencimento': 'dueDate',
        'descricao': 'description',
        'descrição': 'description',
        'juros': 'interest.value',
        'multa': 'fine.value',
        'desconto': 'discount.value',
        'referencia': 'externalReference',
        'referência': 'externalReference',
        'notificacao': 'sendNotification',
        'notificação': 'sendNotification',
    };

    const campoInterno = reverseMap[campo.toLowerCase()] || campo;

    const formData = new URLSearchParams();
    formData.append('id', id);
    formData.append(campoInterno, valor);

    const res = await fetch(`${BASE_URL}/payment/update`, {
        method: 'POST',
        headers: {
            ...getHeaders(),
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
        redirect: 'manual',
    });

    if (res.status === 200 || res.status === 302) {
        console.log(`✓ Cobrança ${id} atualizada: ${campo} = "${valor}"`);
        return true;
    } else {
        const text = await res.text();
        console.error('Erro ao editar:', text.substring(0, 500));
        return false;
    }
}

// ============================================
// CRIAR COBRANÇA
// ============================================
async function criarCobranca(customerAccountId, valor, vencimento, descricao) {
    const formData = new URLSearchParams();
    formData.append('customerAccountId', customerAccountId);
    formData.append('chargeType', 'DETACHED');
    formData.append('chargeTarget', 'individual');
    formData.append('billingType', 'BOLETO');
    formData.append('totalValue', valor);
    formData.append('value', valor);
    formData.append('dueDate', vencimento);
    formData.append('interest.value', '2,00');
    formData.append('fine.fineType', 'PERCENTAGE');
    formData.append('fine.value', '1,00');
    formData.append('description', descricao);

    const res = await fetch(`${BASE_URL}/payment/save`, {
        method: 'POST',
        headers: {
            ...getHeaders(),
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
        redirect: 'manual',
    });

    if (res.status === 200) {
        const json = await res.json().catch(() => null);
        if (json && json.success) {
            console.log(`✓ Cobrança criada com sucesso! ID: ${json.pid}`);
            const links = {
                boleto: `https://www.asaas.com/b/pdf/${json.externalTokens}`,
                fatura: `https://www.asaas.com/i/${json.externalTokens}`
            };
            console.log(`  👉 Visualizar Boleto (PDF):  ${links.boleto}`);
            console.log(`  👉 Visualizar Fatura (Web):  ${links.fatura}`);
            return json;
        } else {
            console.error('Erro ao salvar cobrança:', JSON.stringify(json));
            return null;
        }
    } else {
        const text = await res.text();
        console.error(`Erro ao criar cobrança: HTTP ${res.status}`, text.substring(0, 500));
        return null;
    }
}

// ============================================
// EDITAR JUROS/MULTA/DESCONTO
// ============================================
async function editarJurosMulta(id, juros, multa, desconto) {
    const formData = new URLSearchParams();
    formData.append('id', id);
    if (juros !== undefined) formData.append('interest.value', juros);
    if (multa !== undefined) formData.append('fine.value', multa);
    if (desconto !== undefined) formData.append('discount.value', desconto);

    const res = await fetch(`${BASE_URL}/payment/updateInterestFineDiscount/${id}`, {
        method: 'POST',
        headers: {
            ...getHeaders(),
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
        redirect: 'manual',
    });

    if (res.status === 200 || res.status === 302) {
        console.log(`✓ Juros/Multa/Desconto da cobrança ${id} atualizados.`);
        return true;
    } else {
        const text = await res.text();
        console.error('Erro:', text.substring(0, 500));
        return false;
    }
}

// ============================================
// DELETAR COBRANÇA
// ============================================
async function deletarCobranca(id) {
    const formData = new URLSearchParams();
    formData.append('id', id);

    const res = await fetch(`${BASE_URL}/payment/deleteAjax`, {
        method: 'POST',
        headers: {
            ...getHeaders(),
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
    });

    const json = await res.json().catch(() => null);
    if (json && json.success) {
        console.log(`✓ Cobrança ${id} deletada com sucesso.`);
    } else {
        console.log(`Resposta:`, JSON.stringify(json));
    }
}

// ============================================
// CONFIRMAR RECEBIMENTO EM DINHEIRO
// ============================================
async function confirmarRecebimento(id) {
    const formData = new URLSearchParams();
    formData.append('id', id);
    formData.append('paymentDate', new Date().toLocaleDateString('pt-BR'));
    formData.append('value', '');

    const res = await fetch(`${BASE_URL}/payment/confirmReceivedInCash`, {
        method: 'POST',
        headers: {
            ...getHeaders(),
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
    });

    const json = await res.json().catch(() => ({ status: res.status }));
    console.log('Resultado:', JSON.stringify(json));
}

// Função para executar tarefas em paralelo com limite de concorrência
async function mapConcurrent(items, limit, fn) {
    const results = [];
    const executing = new Set();
    for (const item of items) {
        const p = Promise.resolve().then(() => fn(item));
        results.push(p);
        executing.add(p);
        const clean = () => executing.delete(p);
        p.then(clean, clean);
        if (executing.size >= limit) {
            await Promise.race(executing);
        }
    }
    return Promise.all(results);
}

// ============================================
// EXPORTAR COBRANÇAS
// ============================================
async function exportarCobrancas(customerAccountId = null) {
    console.log('Buscando cobranças...');
    let todas = [];
    let offset = 0;
    const max = 50;

    while (true) {
        const lote = await listarCobrancas(customerAccountId, offset, max);
        if (lote.length === 0) break;
        todas = todas.concat(lote);
        offset += max;
        if (lote.length < max) break;
    }

    console.log(`Total: ${todas.length} cobranças encontradas.`);
    console.log('Consultando detalhes de forma concorrente (máximo 15 requisições paralelas)...');

    let concluido = 0;
    const detalhadas = await mapConcurrent(todas, 15, async (c) => {
        const detalhe = await consultarCobranca(c.id);
        concluido++;
        process.stdout.write(`\r  Progresso: ${concluido}/${todas.length} (${Math.round((concluido / todas.length) * 100)}%)`);
        return detalhe || c;
    });
    console.log('\n✓ Detalhes carregados.');

    const suffix = customerAccountId ? `_cliente_${customerAccountId}` : '';
    const outputPath = path.join(__dirname, `cobrancas_export${suffix}.json`);
    fs.writeFileSync(outputPath, JSON.stringify(detalhadas, null, 2), 'utf-8');
    console.log(`\n✓ Exportado para: ${outputPath}`);
    return detalhadas;
}

// ============================================
// MAPEAR FLUXO DE EDICÃO E BOLETO (NÃO DESTRUTIVO)
// ============================================
async function mapearFluxoCobranca(id) {
    const url = `${BASE_URL}/payment/show/${id}`;
    const res = await fetch(url, { headers: getHeaders() });

    if (res.status !== 200) {
        console.error(`Erro ao consultar cobrança ${id}: HTTP ${res.status}`);
        return;
    }

    const html = await res.text();

    console.log('\n╔══════════════════════════════════════════════════════════════════════╗');
    console.log('║               MAPEAMENTO NÃO-DESTRUTIVO DE FLUXO                     ║');
    console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

    // 1. Campo de Vencimento
    console.log('1. [CAMPO DE VENCIMENTO]');
    const dueDateMatch = html.match(/<input[^>]*name="dueDate"[^>]*>/i) || html.match(/<input[^>]*id="dueDate"[^>]*>/i);
    if (dueDateMatch) {
        console.log(`   Elemento HTML encontrado: ${dueDateMatch[0]}`);
        const valueMatch = dueDateMatch[0].match(/value="([^"]*)"/i);
        const formatMatch = dueDateMatch[0].match(/data-date-format="([^"]*)"/i);
        console.log(`   - Nome do input: "dueDate"`);
        console.log(`   - ID do input:   "dueDate"`);
        console.log(`   - Valor Atual:   "${valueMatch ? valueMatch[1] : 'Não encontrado'}"`);
        console.log(`   - Formato data:  "${formatMatch ? formatMatch[1] : 'dd/mm/yyyy'}"`);
        console.log(`   - Seletor CSS:   "input#dueDate" ou "input[name='dueDate']"`);
    } else {
        console.log('   [AVISO] Campo input#dueDate não encontrado diretamente no HTML.');
    }
    console.log('');

    // 2. Ação de Salvar (Endpoint e Payload)
    console.log('2. [AÇÃO DE SALVAR - SIMULADA]');
    console.log('   - Endpoint:   POST https://www.asaas.com/payment/update');
    console.log('   - Método:     POST');
    console.log('   - Payload:    application/x-www-form-urlencoded');
    console.log('   - Parâmetros:');
    console.log(`     * id:       "${id}"`);
    console.log(`     * dueDate:  "dd/mm/yyyy" (Ex: "25/06/2026")`);
    console.log('   - Exemplo de payload a enviar:');
    console.log(`     id=${id}&dueDate=25/06/2026`);
    console.log('   - Headers necessários:');
    console.log('     * Cookie:           [Sessão Ativa]');
    console.log('     * User-Agent:       [Mozilla/5.0...]');
    console.log('     * X-Requested-With: "XMLHttpRequest"');
    console.log('');

    // 3. Mais Ações e Visualização do Boleto/Fatura
    console.log('3. [MAIS AÇÕES & VISUALIZAR BOLETO]');
    const previewBoletoBtn = html.includes('js-preview-boleto-button') || html.includes('previewBoletoActionButton');
    const previewInvoiceBtn = html.includes('js-preview-invoice-button') || html.includes('previewInvoiceActionButton');

    console.log(`   - Botão "Mais Ações":          #moreActionsActionButton ou [data-testid="e2e-payment-more-actions-button"]`);
    console.log(`   - Opção "Visualizar boleto":    ${previewBoletoBtn ? '✓ Elemento #previewBoletoActionButton encontrado' : '✗ Não encontrado'}`);
    console.log(`   - Opção "Visualizar fatura":    ${previewInvoiceBtn ? '✓ Elemento #previewInvoiceActionButton encontrado' : '✗ Não encontrado'}`);

    // Extrair links escondidos
    const boletoLinkMatch = html.match(/class="js-boleto-link"\s*value="([^"]*)"/i) || html.match(/value="([^"]*)"\s*class="js-boleto-link"/i);
    const originalBoletoLinkMatch = html.match(/class="js-original-boleto-link"\s*value="([^"]*)"/i) || html.match(/value="([^"]*)"\s*class="js-original-boleto-link"/i);
    const faturaLinkMatch = html.match(/href="\/i\/([^"]*)"/i) || html.match(/href=['"]\/i\/([^'"]*)['"]/i);

    console.log('\n   - Links de Visualização extraídos do HTML:');
    if (boletoLinkMatch) {
        console.log(`     * Visualizar Boleto (PDF):`);
        console.log(`       URL Relativa: ${boletoLinkMatch[1]}`);
        console.log(`       URL Completa:  ${BASE_URL}${boletoLinkMatch[1]}`);
    } else {
        console.log('     * Visualizar Boleto (PDF): Não encontrado no HTML.');
    }

    if (originalBoletoLinkMatch) {
        console.log(`     * Visualizar Boleto Original (PDF):`);
        console.log(`       URL Relativa: ${originalBoletoLinkMatch[1]}`);
        console.log(`       URL Completa:  ${BASE_URL}${originalBoletoLinkMatch[1]}`);
    }

    if (faturaLinkMatch) {
        console.log(`     * Visualizar Fatura Online:`);
        console.log(`       URL Relativa: /i/${faturaLinkMatch[1]}`);
        console.log(`       URL Completa:  ${BASE_URL}/i/${faturaLinkMatch[1]}`);
    } else if (boletoLinkMatch) {
        const parts = boletoLinkMatch[1].split('/');
        const token = parts[parts.length - 1];
        if (token) {
            console.log(`     * Visualizar Fatura Online (token deduzido):`);
            console.log(`       URL Completa:  ${BASE_URL}/i/${token}`);
        }
    }

    console.log('\n   - Como visualizar de forma não-destrutiva sem salvar nem modificar nada:');
    console.log(`     Você pode abrir o link "URL Completa" do boleto/fatura diretamente no navegador`);
    console.log(`     ou fazer um GET HTTP usando os cookies de sessão salvos.`);
}

// ============================================
// MAIN
// ============================================
async function main() {
    const [,, comando, ...args] = process.argv;

    if (!process.env.COOKIE_STRING) {
        console.error('ERRO: COOKIE_STRING não encontrada no .env.');
        console.error('Execute "node capture.js" primeiro.');
        process.exit(1);
    }

    switch (comando) {
        case 'listar': {
            const cobrancas = await listarCobrancas();
            console.log('\n╔══════════════════════════════════════════════════════════════════════╗');
            console.log('║                     COBRANÇAS - ASAAS                                ║');
            console.log('╚══════════════════════════════════════════════════════════════════════╝\n');
            cobrancas.forEach((c, i) => {
                console.log(`  ${i + 1}. ${c.cliente}`);
                console.log(`     ID: ${c.id} | ${c.valor} | Tipo: ${c.tipo} | Venc: ${c.vencimento}`);
                console.log('');
            });
            console.log(`Total: ${cobrancas.length} cobranças.`);
            break;
        }

        case 'listar-cliente': {
            const clienteId = args[0];
            if (!clienteId) {
                console.error('Uso: node cobrancas/asaas_cobrancas.js listar-cliente <clienteId>');
                process.exit(1);
            }
            const cobrancas = await listarCobrancas(clienteId);
            console.log(`\n╔══════════════════════════════════════════════════════════════════════╗`);
            console.log(`║              COBRANÇAS DO CLIENTE ${clienteId}                    ║`);
            console.log(`╚══════════════════════════════════════════════════════════════════════╝\n`);
            cobrancas.forEach((c, i) => {
                console.log(`  ${i + 1}. ${c.cliente}`);
                console.log(`     ID: ${c.id} | ${c.valor} | Tipo: ${c.tipo} | Venc: ${c.vencimento}`);
                console.log('');
            });
            console.log(`Total: ${cobrancas.length} cobranças.`);
            break;
        }

        case 'consultar': {
            const id = args[0];
            if (!id) {
                console.error('Uso: node cobrancas/asaas_cobrancas.js consultar <cobrancaId>');
                process.exit(1);
            }
            const cobranca = await consultarCobranca(id);
            if (cobranca) {
                console.log('\n╔══════════════════════════════════════════════════════════════════════╗');
                console.log('║                     DETALHES DA COBRANÇA                            ║');
                console.log('╚══════════════════════════════════════════════════════════════════════╝\n');
                for (const [key, value] of Object.entries(cobranca)) {
                    if (value) console.log(`  ${key}: ${value}`);
                }
            }
            break;
        }

        case 'juros': {
            const id = args[0];
            if (!id) {
                console.error('Uso: node cobrancas/asaas_cobrancas.js juros <cobrancaId>');
                process.exit(1);
            }
            const data = await consultarJurosMulta(id);
            console.log('\n  Juros/Multa/Desconto:');
            console.log(JSON.stringify(data, null, 2));
            break;
        }

        case 'criar': {
            const [customerAccountId, valor, vencimento, ...descricaoParts] = args;
            const descricao = descricaoParts.join(' ');
            if (!customerAccountId || !valor || !vencimento || !descricao) {
                console.error('Uso: node cobrancas/asaas_cobrancas.js criar <customerAccountId> <valor> <vencimento> <descrição>');
                process.exit(1);
            }
            await criarCobranca(customerAccountId, valor, vencimento, descricao);
            break;
        }

        case 'editar': {
            const [id, campo, ...valorParts] = args;
            const valor = valorParts.join(' ');
            if (!id || !campo || !valor) {
                console.error('Uso: node cobrancas/asaas_cobrancas.js editar <cobrancaId> <campo> <valor>');
                console.error('Campos: valor, vencimento, descricao, juros, multa, desconto, referencia, notificacao');
                process.exit(1);
            }
            await editarCobranca(id, campo, valor);
            break;
        }

        case 'editar-juros': {
            const id = args[0];
            if (!id) {
                console.error('Uso: node cobrancas/asaas_cobrancas.js editar-juros <cobrancaId>');
                process.exit(1);
            }
            const juros = await ask('Juros (% ao mês): ');
            const multa = await ask('Multa (R$): ');
            const desconto = await ask('Desconto (R$): ');
            await editarJurosMulta(id, juros || undefined, multa || undefined, desconto || undefined);
            break;
        }

        case 'exportar': {
            const clienteId = args[0] || null;
            await exportarCobrancas(clienteId);
            break;
        }

        case 'deletar': {
            const delId = args[0];
            if (!delId) {
                console.error('Uso: node cobrancas/asaas_cobrancas.js deletar <cobrancaId>');
                process.exit(1);
            }
            const confirma = await ask(`Tem certeza que deseja deletar a cobrança ${delId}? (s/n): `);
            if (confirma.toLowerCase() === 's') {
                await deletarCobranca(delId);
            }
            break;
        }

        case 'confirmar-recebimento': {
            const crId = args[0];
            if (!crId) {
                console.error('Uso: node cobrancas/asaas_cobrancas.js confirmar-recebimento <cobrancaId>');
                process.exit(1);
            }
            await confirmarRecebimento(crId);
            break;
        }

        case 'mapear-fluxo': {
            const id = args[0];
            if (!id) {
                console.error('Uso: node cobrancas/asaas_cobrancas.js mapear-fluxo <cobrancaId>');
                process.exit(1);
            }
            await mapearFluxoCobranca(id);
            break;
        }

        default: {
            console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║               ASAAS - AUTOMAÇÃO DE COBRANÇAS                       ║
╚══════════════════════════════════════════════════════════════════════╝

Comandos disponíveis:

  node cobrancas/asaas_cobrancas.js listar                              Lista todas as cobranças
  node cobrancas/asaas_cobrancas.js listar-cliente <clienteId>          Lista cobranças de um cliente
  node cobrancas/asaas_cobrancas.js consultar <cobrancaId>              Consulta detalhes de uma cobrança
  node cobrancas/asaas_cobrancas.js criar <clienteId> <valor> <vencimento> <descrição> Cria uma cobrança
  node cobrancas/asaas_cobrancas.js editar <cobrancaId> <campo> <valor> Edita uma cobrança
  node cobrancas/asaas_cobrancas.js editar-juros <cobrancaId>           Edita juros/multa/desconto (interativo)
  node cobrancas/asaas_cobrancas.js juros <cobrancaId>                  Consulta juros/multa/desconto atuais
  node cobrancas/asaas_cobrancas.js exportar [clienteId]                Exporta cobranças para JSON
  node cobrancas/asaas_cobrancas.js deletar <cobrancaId>                Deleta uma cobrança
  node cobrancas/asaas_cobrancas.js confirmar-recebimento <cobrancaId>  Confirma recebimento em dinheiro
  node cobrancas/asaas_cobrancas.js mapear-fluxo <cobrancaId>           Mapeia fluxo de edição e boleto (não destrutivo)

Campos editáveis:
  valor, vencimento, descricao, juros, multa, desconto, referencia, notificacao

Endpoints mapeados:
  GET  /paymentList/loadTableContent               Lista cobranças (tabela)
  GET  /paymentList/loadTableContent?customerAccountId=<id>  Cobranças por cliente
  GET  /payment/show/<id>                           Detalhes da cobrança
  POST /payment/save                                Criar cobrança
  POST /payment/update                              Editar cobrança
  POST /payment/deleteAjax                          Deletar cobrança
  POST /payment/confirmReceivedInCash               Confirmar recebimento
  GET  /payment/loadInterestFineDiscount/<id>       Carregar juros/multa
  POST /payment/updateInterestFineDiscount/<id>     Atualizar juros/multa
  POST /payment/refund/<id>                         Reembolsar
  POST /payment/sendDueDateWarning                  Enviar lembrete vencimento
  GET  /payment/export                              Exportar cobranças (CSV)
`);
        }
    }
}

main().catch(err => {
    console.error('Erro:', err.message);
    process.exit(1);
});
