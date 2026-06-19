/**
 * CONTA AZUL - Sistema Interativo de Consulta de Extrato
 * 
 * Permite buscar clientes no Conta Azul Mais, alternar a sessão
 * para o Conta Azul Pro do cliente (resolvendo o modal de sessão ativa)
 * e extrair todas as movimentações financeiras por HTTP.
 * 
 * Uso:
 *   node contaazul/interativo.js
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const readline = require('readline');
const fs = require('fs');

const BASE_URL = 'https://mais.contaazul.com';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

function parseDate(dateStr) {
    // Converte dd/mm/yyyy para objeto Date
    const parts = dateStr.split('/');
    if (parts.length !== 3) return null;
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const year = parseInt(parts[2], 10);
    const d = new Date(year, month, day);
    return isNaN(d.getTime()) ? null : d;
}

function formatDateBr(dateStr) {
    // Converte yyyy-mm-dd para dd/mm/yyyy
    if (!dateStr) return 'N/A';
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

// Obter a lista de clientes via HTTP usando os cookies salvos no state.json
async function obterClientes(state) {
    const cookieString = state.cookies.map(c => `${c.name}=${c.value}`).join('; ');
    const accountancyToken = state.cookies.find(c => c.name === 'auth-token-accountancy')?.value;

    const url = 'https://services.contaazul.com/camais-acc-customers/v2/customers?search=&page=1&pageSize=150&tabFilter=ALL';
    const headers = {
        'Cookie': cookieString,
        'accountancy-token': accountancyToken || '',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://mais.contaazul.com/',
        'Origin': 'https://mais.contaazul.com'
    };

    const res = await fetch(url, { headers });
    if (res.status !== 200) {
        throw new Error(`Erro ao buscar lista de clientes (HTTP ${res.status})`);
    }

    const json = await res.json();
    // Filtrar apenas clientes ativos que possuem tenantId
    return (json.items || []).filter(c => c.tenantId && c.tenantId > 0);
}

// Obtém o auth-token do Conta Azul Pro via HTTP
async function obterAuthTokenClienteHTTP(relationId, state) {
    console.log(`\n[HTTP] Efetuando a troca de sessão para a relação ID: ${relationId}...`);
    const cookieString = state.cookies.map(c => `${c.name}=${c.value}`).join('; ');
    const accountancyToken = state.cookies.find(c => c.name === 'auth-token-accountancy')?.value;

    // 1. GET /rest/relation/{relationId}/login?isCaMaisPlan=false
    const loginUrl = `https://accountancy.contaazul.com/rest/relation/${relationId}/login?isCaMaisPlan=false`;
    const loginRes = await fetch(loginUrl, {
        headers: {
            'Cookie': cookieString,
            'accountancy-token': accountancyToken || '',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, Gecko) Chrome/122.0.0.0 Safari/537.36'
        },
        redirect: 'manual'
    });

    if (loginRes.status !== 302) {
        throw new Error(`Erro no login da relação (Status: ${loginRes.status})`);
    }

    const setCookies1 = loginRes.headers.getSetCookie();
    let redirectToken = '';
    for (const cookie of setCookies1) {
        if (cookie.includes('redirect_token=')) {
            redirectToken = cookie.split('redirect_token=')[1].split(';')[0];
        }
    }

    if (!redirectToken) {
        throw new Error('redirect_token não encontrado nos cookies de resposta.');
    }

    // 2. GET /rest/login/heimdall
    const cookieString2 = cookieString + `; redirect_token=${redirectToken}`;
    const heimdallUrl = 'https://app.contaazul.com/rest/login/heimdall';
    
    const heimdallRes = await fetch(heimdallUrl, {
        headers: {
            'Cookie': cookieString2,
            'accountancy-token': accountancyToken || '',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, Gecko) Chrome/122.0.0.0 Safari/537.36'
        },
        redirect: 'manual'
    });

    if (heimdallRes.status !== 303) {
        throw new Error(`Erro no redirecionamento do Heimdall (Status: ${heimdallRes.status})`);
    }

    const setCookies2 = heimdallRes.headers.getSetCookie();
    let authToken = '';
    for (const cookie of setCookies2) {
        if (cookie.includes('auth-token=')) {
            const val = cookie.split('auth-token=')[1].split(';')[0];
            if (val) {
                authToken = val;
            }
        }
    }

    if (!authToken) {
        throw new Error('auth-token não encontrado nos cookies do Heimdall.');
    }

    return authToken;
}

// Buscar as movimentações financeiras via HTTP (API Pro) com paginação completa
async function obterMovimentacoes(authToken, searchFilter = null) {
    let todas = [];
    let page = 1;
    const pageSize = 100;

    console.log('  Iniciando busca de lançamentos no extrato...');

    const bodyObj = {};
    if (searchFilter) {
        bodyObj.search = searchFilter;
    }

    while (true) {
        const url = `https://services.contaazul.com/finance-pro-reader/v1/financial-statement-view?page=${page}&page_size=${pageSize}`;
        const headers = {
            'x-authorization': authToken,
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Origin': 'https://pro.contaazul.com',
            'Referer': 'https://pro.contaazul.com/'
        };

        const res = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(bodyObj)
        });

        if (res.status !== 200) {
            console.error(`\n❌ Erro ao buscar página ${page}: HTTP ${res.status}`);
            break;
        }

        const json = await res.json();
        const items = json.items || [];
        
        if (items.length === 0) break;

        todas = todas.concat(items);
        process.stdout.write(`\r  Carregados ${todas.length} lançamentos do extrato...`);

        if (items.length < pageSize) break;
        page++;
    }

    console.log('\n  Lançamentos carregados do extrato com sucesso!');
    return todas;
}

// Helper functions for the billing flow

async function buscarDetalhesLancamento(authToken, eventId) {
    const url = `https://services.contaazul.com/finance-pro/v1/financial-events/${eventId}`;
    const headers = {
        'x-authorization': authToken,
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    };
    const res = await fetch(url, { headers });
    if (res.status !== 200) {
        throw new Error(`Erro ao buscar detalhes do lançamento (HTTP ${res.status})`);
    }
    return await res.json();
}

async function cancelarCobrancaExistente(authToken, chargeRequests) {
    const url = 'https://services.contaazul.com/finance-pro/v1/charge-requests/batch-cancel';
    const headers = {
        'x-authorization': authToken,
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    };
    const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ chargeRequests })
    });
    if (res.status !== 204 && res.status !== 200) {
        throw new Error(`Erro ao cancelar cobrança existente (HTTP ${res.status})`);
    }
    return true;
}

async function alterarVencimento(authToken, installmentId, novaData, version) {
    const url = `https://services.contaazul.com/finance-pro/v1/installments/${installmentId}`;
    const headers = {
        'x-authorization': authToken,
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    };
    const body = {
        dueDate: novaData,
        expectedPaymentDate: novaData,
        isCaPaymentType: true,
        version: version
    };
    const res = await fetch(url, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(body)
    });
    if (res.status !== 200) {
        throw new Error(`Erro ao alterar vencimento da parcela (HTTP ${res.status})`);
    }
    return await res.json();
}

async function buscarEmailCobranca(authToken, personId) {
    const url = `https://services.contaazul.com/contaazul-bff/person-registration/v1/persons/${personId}/billing-contact`;
    const headers = {
        'x-authorization': authToken,
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    };
    const res = await fetch(url, { headers });
    if (res.status !== 200) {
        throw new Error(`Erro ao buscar email de cobrança (HTTP ${res.status})`);
    }
    return await res.json();
}

async function emitirBoleto(authToken, financialAccountId, installmentId, installmentVersion, originalDescription, dueDate, value, index, email) {
    const url = 'https://services.contaazul.com/finance-pro/v2/charge-requests/batch-create';
    const headers = {
        'x-authorization': authToken,
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    };
    const body = {
        financialAccountId,
        installmentGroups: [{
            originalDescription,
            description: `${originalDescription} - ${index}/${index}`, // Ex: Venda 924 - 1/1
            installmentIds: [{ id: installmentId, version: installmentVersion }],
            dueDate,
            value,
            index
        }],
        type: 'RECEBA_FACIL_BANK_SLIP',
        customAttributes: { charge: { type: 'INVOICE' } },
        notification: {
            emails: [email],
            scheduled: true,
            instantSending: false,
            smsNumbers: [],
            whatsappNumbers: []
        }
    };
    const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
    });
    if (res.status !== 200) {
        const text = await res.text();
        throw new Error(`Erro ao emitir boleto (HTTP ${res.status}): ${text}`);
    }
    return await res.json();
}

async function obterSummary(authToken, eventId) {
    const url = `https://services.contaazul.com/contaazul-bff/finance/v1/financial-events/${eventId}/summary`;
    const headers = {
        'x-authorization': authToken,
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    };
    const res = await fetch(url, { headers });
    if (res.status !== 200) {
        throw new Error(`Erro ao obter resumo do evento financeiro (HTTP ${res.status})`);
    }
    return await res.json();
}

async function aguardarUrlCobranca(authToken, eventId, chargeRequestId) {
    console.log('  Aguardando geração dos dados e URL de fatura do boleto (polling)...');
    const maxTentativas = 10;
    const delayMs = 2000;
    
    for (let i = 1; i <= maxTentativas; i++) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
        try {
            const summary = await obterSummary(authToken, eventId);
            const installments = summary.paymentCondition?.installments || [];
            
            for (const inst of installments) {
                const req = (inst.chargeRequests || []).find(r => r.id === chargeRequestId);
                if (req && req.url) {
                    console.log(`  ✓ URL do boleto gerada na tentativa ${i}!`);
                    return req; // Contém { id, url, referenceId, ... }
                }
            }
            process.stdout.write(`  [Tentativa ${i}/${maxTentativas}] Processando no Conta Azul...\r`);
        } catch (err) {
            console.error(`\n⚠️ Erro na tentativa ${i} do polling:`, err.message);
        }
    }
    throw new Error('Timeout ao aguardar a confirmação e URL do boleto.');
}

async function downloadBoleto(authToken, clientName, chargeRequestId, faturaUrl, downloadPath) {
    const url = 'https://services.contaazul.com/finance-pro-reports/v3/aggregate-pdfs-by-customer';
    const headers = {
        'x-authorization': authToken,
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    };
    const body = [
        {
            name: clientName,
            chargeRequests: [
                {
                    id: chargeRequestId,
                    url: faturaUrl
                }
            ]
        }
    ];
    const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
    });
    if (res.status !== 200) {
        throw new Error(`Erro ao baixar boleto PDF (HTTP ${res.status})`);
    }
    
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(downloadPath, buffer);
    console.log(`✓ Boleto baixado com sucesso em: ${downloadPath}`);
    return downloadPath;
}

async function processarFluxoLancamento(authToken, lancamento, state) {
    console.log(`\n✓ Lançamento selecionado: ${lancamento.description} (${formatDateBr(lancamento.date)} - R$ ${lancamento.value.toFixed(2)})`);
    
    console.log('  Buscando detalhes do lançamento...');
    const detalhes = await buscarDetalhesLancamento(authToken, lancamento.financialEventId);
    
    const targetInstallmentId = lancamento.id;
    const installment = (detalhes.paymentCondition?.installments || []).find(i => i.id === targetInstallmentId);
    
    if (!installment) {
        console.error('❌ Parcela correspondente não encontrada nos detalhes do lançamento.');
        return;
    }
    
    console.log('\n========================================================================');
    console.log('             DETALHES DO LANÇAMENTO SELECIONADO');
    console.log('========================================================================');
    console.log(`  Descrição:       ${detalhes.description || 'N/A'}`);
    console.log(`  Valor:           R$ ${(detalhes.value || lancamento.value).toFixed(2)}`);
    const finalClient = detalhes.negotiator?.name || lancamento.negotiator?.name || 'N/A';
    const finalDocument = detalhes.negotiator?.legalDocument || lancamento.negotiator?.legalDocument;
    console.log(`  Cliente:         ${finalClient}`);
    if (finalDocument) {
        console.log(`  CNPJ/CPF:        ${finalDocument}`);
    }
    console.log(`  Categoria:       ${detalhes.categoriesRatio?.[0]?.category || 'N/A'}`);
    console.log(`  Método Pagto:    ${installment.paymentMethod || lancamento.paymentMethod || 'N/A'}`);
    console.log(`  Parcela:         ${installment.index || 1} de ${detalhes.paymentCondition?.installmentsCount || 1}`);
    console.log(`  Conta PJ:        ${installment.financialAccount?.name || 'N/A'}`);
    
    // Listar as cobranças/boletos associados a esta parcela
    const cobrancas = installment.chargeRequests || [];
    if (cobrancas.length > 0) {
        console.log('\n  Cobranças/Boletos vinculados:');
        cobrancas.forEach((c, cidx) => {
            console.log(`    [Boleto ${cidx + 1}] ID: ${c.id} | Status: ${c.status} | Vcto: ${formatDateBr(c.dueDate)}`);
            if (c.url) {
                console.log(`             URL Fatura: ${c.url}`);
            }
        });
    } else {
        console.log('\n  Cobranças/Boletos vinculados: Nenhum boleto emitido.');
    }
    console.log('========================================================================');

    console.log(`\nVencimento atual: ${formatDateBr(installment.dueDate)}`);
    const novaDataBr = await ask('Digite o novo vencimento (dd/mm/aaaa) ou "cancelar": ');
    if (novaDataBr.toLowerCase().trim() === 'cancelar') {
        return;
    }
    
    const novaDataObj = parseDate(novaDataBr);
    if (!novaDataObj) {
        console.log('❌ Data inválida.');
        return;
    }
    const ano = novaDataObj.getFullYear();
    const mes = String(novaDataObj.getMonth() + 1).padStart(2, '0');
    const dia = String(novaDataObj.getDate()).padStart(2, '0');
    const novaDataIso = `${ano}-${mes}-${dia}`;
    
    const activeCharges = (installment.chargeRequests || []).filter(c => c.status !== 'CANCELED');
    if (activeCharges.length > 0) {
        console.log(`  Cancelando ${activeCharges.length} cobrança(s) existente(s)...`);
        await cancelarCobrancaExistente(authToken, activeCharges);
        console.log('  ✓ Cobrança(s) anterior(es) cancelada(s) com sucesso!');
    }
    
    console.log('  Alterando vencimento da parcela...');
    const installmentAtualizado = await alterarVencimento(authToken, installment.id, novaDataIso, installment.version);
    console.log(`  ✓ Vencimento alterado com sucesso para ${formatDateBr(novaDataIso)}!`);
    
    console.log('  Buscando email de cobrança do cliente...');
    let emailCobranca = '';
    try {
        const billingInfo = await buscarEmailCobranca(authToken, detalhes.negotiatorId);
        emailCobranca = billingInfo.emails?.[0] || detalhes.negotiator?.email || '';
    } catch (err) {
        console.log('  ⚠️ Não foi possível obter o email de cobrança. Usando email padrão do cadastro.');
        emailCobranca = detalhes.negotiator?.email || '';
    }
    
    console.log(`\nEmail do destinatário encontrado: ${emailCobranca || 'Nenhum'}`);
    const emailOpcao = await ask(`Digite o e-mail para envio da cobrança (deixe em branco para usar "${emailCobranca}"): `);
    const emailFinal = emailOpcao.trim() || emailCobranca;
    
    if (!emailFinal) {
        console.log('❌ O e-mail para envio da cobrança é obrigatório.');
        return;
    }
    
    console.log('  Emitindo novo boleto...');
    const financialAccountId = installment.financialAccount?.id || 'cf6eedce-10e8-4554-b707-9246826b12c6';
    const novaVersaoInstallment = installmentAtualizado.version;
    const originalDescription = detalhes.description || lancamento.description;
    const index = installment.index || 1;
    const value = lancamento.value;
    
    const emissionRes = await emitirBoleto(
        authToken,
        financialAccountId,
        installment.id,
        novaVersaoInstallment,
        originalDescription,
        novaDataIso,
        value,
        index,
        emailFinal
    );
    
    const newChargeRequest = emissionRes.items?.[0];
    if (!newChargeRequest || !newChargeRequest.id) {
        console.error('❌ Falha ao obter ID da nova cobrança gerada.');
        return;
    }
    
    console.log(`  ✓ Boleto emitido com sucesso! ID da cobrança: ${newChargeRequest.id}`);
    
    const confirmedCharge = await aguardarUrlCobranca(authToken, detalhes.id, newChargeRequest.id);
    
    console.log('  Iniciando download do boleto...');
    const clientName = detalhes.negotiator?.name || 'Cliente';
    const cleanClientName = clientName.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30);
    const pdfFilename = `boleto_${cleanClientName}_${newChargeRequest.id.substring(0, 8)}.pdf`;
    
    const downloadDir = path.resolve(__dirname, 'downloads');
    if (!fs.existsSync(downloadDir)) {
        fs.mkdirSync(downloadDir, { recursive: true });
    }
    const downloadPath = path.join(downloadDir, pdfFilename);
    
    await downloadBoleto(authToken, clientName, confirmedCharge.id, confirmedCharge.url, downloadPath);
}

async function buscarCnpjInfo(authToken, cnpj) {
    const cleanCnpj = cnpj.replace(/\D/g, '');
    const url = `https://services.contaazul.com/contaazul-bff/account/v1/company-info/${cleanCnpj}`;
    const headers = {
        'x-authorization': authToken,
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    };
    const res = await fetch(url, { headers });
    if (res.status !== 200) {
        throw new Error(`Erro ao buscar dados do CNPJ: HTTP ${res.status}`);
    }
    return await res.json();
}

async function buscarCepInfo(cookieString, cep) {
    const cleanCep = cep.replace(/\D/g, '');
    const url = `https://app.contaazul.com/buscaCep.action?cep=${cleanCep}`;
    const headers = {
        'Cookie': cookieString,
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    };
    const res = await fetch(url, { headers });
    if (res.status !== 200) {
        throw new Error(`Erro ao buscar CEP: HTTP ${res.status}`);
    }
    return await res.json();
}

async function salvarNovoCliente(authToken, payload) {
    const url = 'https://services.contaazul.com/contaazul-bff/person-registration/v1/persons';
    const headers = {
        'x-authorization': authToken,
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    };
    const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
    });
    if (res.status !== 200 && res.status !== 201) {
        const text = await res.text();
        throw new Error(`Erro ao salvar cliente (HTTP ${res.status}): ${text}`);
    }
    return await res.json();
}

async function cadastrarNovoClienteFluxo(authToken, state) {
    console.log('\n========================================================================');
    console.log('                   CADASTRO DE NOVO CLIENTE');
    console.log('========================================================================');

    // A. Tipo de Pessoa
    let personType = '';
    while (personType !== 'Jurídica' && personType !== 'Física') {
        const tipo = await ask('Tipo de pessoa (J para Jurídica, F para Física) [J/F]: ');
        const t = tipo.trim().toUpperCase();
        if (t === 'J' || t === 'JURIDICA') {
            personType = 'Jurídica';
        } else if (t === 'F' || t === 'FISICA') {
            personType = 'Física';
        } else {
            console.log('❌ Opção inválida.');
        }
    }

    let legalDocument = '';
    let naturalDocument = '';
    let name = '';
    let companyName = '';
    let birthDate = '';
    
    let cnpjInfo = null;
    const cookieString = state.cookies.map(c => `${c.name}=${c.value}`).join('; ');

    // Endereço padrão
    let addressInfo = {
        zipcode: '',
        neighborhood: '',
        numberAddress: '',
        state: '',
        city: 0,
        address: '',
        complement: '',
        country: 'Brasil',
        idCity: 0
    };

    // Informações adicionais
    let emailAdicional = '';
    let commercialPhone = '';
    let cellPhone = '';

    if (personType === 'Jurídica') {
        let cnpjValido = false;
        while (!cnpjValido) {
            const cnpjInput = await ask('Digite o CNPJ do cliente: ');
            const cleaned = cnpjInput.replace(/\D/g, '');
            if (cleaned.length !== 14) {
                console.log('❌ CNPJ deve ter 14 dígitos.');
                continue;
            }
            legalDocument = cleaned;
            cnpjValido = true;
        }

        console.log('  Buscando dados do CNPJ na Receita Federal (Buscar dados)...');
        try {
            cnpjInfo = await buscarCnpjInfo(authToken, legalDocument);
            console.log('✓ Dados recuperados com sucesso!');
            companyName = cnpjInfo.companyName || '';
            name = cnpjInfo.tradingName || cnpjInfo.companyName || '';
            birthDate = cnpjInfo.openDate || '';
            emailAdicional = cnpjInfo.email || '';
            commercialPhone = (cnpjInfo.phoneNumber || '').replace(/\D/g, '');

            // Preencher endereço retornado pelo CNPJ
            addressInfo.zipcode = (cnpjInfo.zipCode || '').replace(/\D/g, '');
            addressInfo.neighborhood = (cnpjInfo.neighborhood || '').toUpperCase();
            addressInfo.state = (cnpjInfo.state || '').toUpperCase();
            addressInfo.address = (cnpjInfo.streetName || '').toUpperCase();
            addressInfo.numberAddress = cnpjInfo.addressNumber || '';
            addressInfo.complement = (cnpjInfo.addressComplement || '').toUpperCase();
        } catch (err) {
            console.log('⚠️ Não foi possível recuperar os dados automaticamente:', err.message);
            console.log('Por favor, preencha os dados manualmente.');
        }

        // Se a busca automática funcionou mas tradingName / name veio em branco, pede Nome fantasia
        if (!name) {
            while (!name) {
                const nameInput = await ask('Nome fantasia: ');
                name = nameInput.trim();
            }
        } else {
            const nameInput = await ask(`Nome fantasia [${name}]: `);
            name = nameInput.trim() || name;
        }

        // Razão social
        if (!companyName) {
            while (!companyName) {
                const companyInput = await ask('Razão Social: ');
                companyName = companyInput.trim();
            }
        } else {
            const companyInput = await ask(`Razão Social [${companyName}]: `);
            companyName = companyInput.trim() || companyName;
        }

    } else {
        // Pessoa Física
        let cpfValido = false;
        while (!cpfValido) {
            const cpfInput = await ask('Digite o CPF do cliente: ');
            const cleaned = cpfInput.replace(/\D/g, '');
            if (cleaned.length !== 11) {
                console.log('❌ CPF deve ter 11 dígitos.');
                continue;
            }
            naturalDocument = cleaned;
            cpfValido = true;
        }

        while (!name) {
            const nameInput = await ask('Nome completo: ');
            name = nameInput.trim();
        }
    }

    // B. Informações Adicionais
    console.log('\n--- INFORMAÇÕES ADICIONAIS ---');
    
    // E-mail adicional
    if (emailAdicional) {
        const modify = await ask(`E-mail adicional pré-preenchido: "${emailAdicional}". Deseja modificar? (s/n) [n]: `);
        if (modify.toLowerCase().trim() === 's') {
            emailAdicional = await ask('Digite o novo e-mail adicional: ');
        }
    } else {
        const emailInput = await ask('E-mail adicional (opcional): ');
        emailAdicional = emailInput.trim();
    }

    // Telefone comercial
    if (commercialPhone) {
        const modify = await ask(`Telefone comercial pré-preenchido: "${commercialPhone}". Deseja modificar? (s/n) [n]: `);
        if (modify.toLowerCase().trim() === 's') {
            commercialPhone = (await ask('Digite o novo telefone comercial (apenas números): ')).replace(/\D/g, '');
        }
    } else {
        const phoneInput = await ask('Telefone comercial (opcional): ');
        commercialPhone = phoneInput.replace(/\D/g, '');
    }

    // Telefone celular
    const cellInput = await ask('Telefone celular (apenas números) [opcional]: ');
    cellPhone = cellInput.replace(/\D/g, '');

    // C. Contato para Cobrança e Faturamento
    console.log('\n--- CONTATO PARA COBRANÇA E FATURAMENTO ---');
    
    // Inicializar e-mail de cobrança com o e-mail adicional se disponível
    let billingEmail = emailAdicional;
    if (billingEmail) {
        const modify = await ask(`E-mail de cobrança pré-preenchido: "${billingEmail}". Deseja modificar? (s/n) [n]: `);
        if (modify.toLowerCase().trim() === 's') {
            billingEmail = await ask('Digite o novo e-mail de cobrança: ');
        }
    } else {
        while (!billingEmail) {
            const emailInput = await ask('❌ E-mail de cobrança (obrigatório): ');
            billingEmail = emailInput.trim();
        }
    }

    // Inicializar WhatsApp de cobrança com celular se disponível
    let billingPhone = cellPhone || commercialPhone;
    if (billingPhone) {
        const modify = await ask(`Número de WhatsApp para cobrança pré-preenchido: "${billingPhone}". Deseja modificar? (s/n) [n]: `);
        if (modify.toLowerCase().trim() === 's') {
            billingPhone = (await ask('Digite o novo WhatsApp de cobrança (apenas números): ')).replace(/\D/g, '');
        }
    } else {
        while (!billingPhone) {
            const phoneInput = await ask('❌ Número de WhatsApp de cobrança (obrigatório): ');
            billingPhone = phoneInput.replace(/\D/g, '');
        }
    }

    // D. Endereço
    console.log('\n--- ENDEREÇO ---');
    
    // Se temos um CEP pré-preenchido, vamos buscar o idCidade
    if (addressInfo.zipcode) {
        console.log(`  Verificando cidade/ID para o CEP: ${addressInfo.zipcode}...`);
        try {
            const cepData = await buscarCepInfo(cookieString, addressInfo.zipcode);
            if (cepData && cepData.idCidade) {
                addressInfo.city = cepData.idCidade;
                addressInfo.idCity = cepData.idCidade;
                console.log(`  ✓ Cidade identificada: ${cepData.nmCidade} (ID: ${cepData.idCidade})`);
            }
        } catch (e) {
            console.log('  ⚠️ Não foi possível verificar o CEP na base do Conta Azul. Será solicitado preenchimento manual.');
        }
    }

    // Exibir o endereço atual
    console.log('\nDados de endereço atuais:');
    console.log(`  CEP:          ${addressInfo.zipcode || 'Não informado'}`);
    console.log(`  Logradouro:   ${addressInfo.address || 'Não informado'}`);
    console.log(`  Número:       ${addressInfo.numberAddress || 'Não informado'}`);
    console.log(`  Bairro:       ${addressInfo.neighborhood || 'Não informado'}`);
    console.log(`  Cidade (ID):  ${addressInfo.city || 'Não identificado'} (Estado: ${addressInfo.state || 'Não informado'})`);
    console.log(`  Complemento:  ${addressInfo.complement || 'Não informado'}`);

    const modifyAddress = await ask('\nDeseja modificar o endereço? (s/n) [n]: ');
    if (modifyAddress.toLowerCase().trim() === 's' || !addressInfo.zipcode || !addressInfo.city) {
        let cepValido = false;
        while (!cepValido) {
            const cepInput = await ask('CEP (apenas números): ');
            const cleanedCep = cepInput.replace(/\D/g, '');
            if (cleanedCep.length !== 8) {
                console.log('❌ CEP deve ter 8 dígitos.');
                continue;
            }
            console.log('  Buscando CEP no Conta Azul...');
            try {
                const cepData = await buscarCepInfo(cookieString, cleanedCep);
                if (cepData && cepData.idCidade) {
                    addressInfo.zipcode = cleanedCep;
                    addressInfo.address = (cepData.nmEndereco || '').toUpperCase();
                    addressInfo.neighborhood = (cepData.nmBairro || '').toUpperCase();
                    addressInfo.state = (cepData.idEstado || '').toUpperCase();
                    addressInfo.city = cepData.idCidade;
                    addressInfo.idCity = cepData.idCidade;
                    console.log(`✓ CEP encontrado! Cidade: ${cepData.nmCidade} - ${cepData.idEstado}`);
                    cepValido = true;
                } else {
                    console.log('❌ CEP não retornado pelo Conta Azul. Tente novamente.');
                }
            } catch (err) {
                console.log('❌ Erro ao buscar CEP:', err.message);
            }
        }

        // Outros campos
        const addressInput = await ask(`Logradouro [${addressInfo.address}]: `);
        addressInfo.address = addressInput.trim().toUpperCase() || addressInfo.address;

        const numberInput = await ask(`Número [${addressInfo.numberAddress}]: `);
        addressInfo.numberAddress = numberInput.trim() || addressInfo.numberAddress;

        const neighborhoodInput = await ask(`Bairro [${addressInfo.neighborhood}]: `);
        addressInfo.neighborhood = neighborhoodInput.trim().toUpperCase() || addressInfo.neighborhood;

        const complementInput = await ask(`Complemento [${addressInfo.complement}]: `);
        addressInfo.complement = complementInput.trim().toUpperCase() || addressInfo.complement;
    }

    // E. Salvar e Retornar
    const savePayload = {
        personType,
        legalDocument,
        naturalDocument,
        name,
        code: '',
        isActive: false,
        isOptingSimple: false,
        companyName: personType === 'Jurídica' ? companyName : '',
        generalRegistry: '',
        birthDate,
        email: emailAdicional,
        commercialPhone,
        cellPhone,
        observation: '',
        idContactPrincipal: '',
        profiles: [{ profileType: 'Cliente' }],
        registrations: [{}],
        otherContacts: [],
        address: [addressInfo],
        doDuplicate: false,
        billingContact: {
            emails: [billingEmail],
            phoneNumber: billingPhone
        },
        origin: 'CadastroUnico'
    };

    console.log('\n  Salvando cliente no Conta Azul...');
    try {
        const responseJson = await salvarNovoCliente(authToken, savePayload);
        console.log(`✓ Cliente "${responseJson.name}" cadastrado com sucesso! UUID: ${responseJson.uuid}`);
        return {
            id: responseJson.uuid,
            name: responseJson.name,
            document: responseJson.legalDocument || responseJson.naturalDocument
        };
    } catch (err) {
        if (err.message.includes('já está cadastrado') || err.message.includes('400')) {
            const doc = legalDocument || naturalDocument;
            console.log(`\n⚠️ O documento ${doc} já está cadastrado no sistema.`);
            console.log('  Buscando cadastro existente...');
            try {
                const existentes = await buscarClientesVenda(authToken, doc);
                const match = existentes.find(c => {
                    const cleanC = (c.document || '').replace(/\D/g, '');
                    return cleanC === doc;
                }) || existentes[0];

                if (match) {
                    const confirm = await ask(`Deseja utilizar o cadastro existente de "${match.name}"? (s/n) [s]: `);
                    if (confirm.toLowerCase().trim() !== 'n') {
                        return {
                            id: match.id,
                            name: match.name,
                            document: match.document || doc
                        };
                    }
                }
            } catch (searchErr) {
                console.error('  Erro ao buscar cadastro existente:', searchErr.message);
            }
        }
        console.error('❌ Falha ao cadastrar cliente:', err.message);
        return null;
    }
}

async function buscarClientesVenda(authToken, searchTerm) {
    const url = `https://services.contaazul.com/contaazul-bff/person-registration/v2/persons?search_term=${encodeURIComponent(searchTerm)}&page=1&page_size=20&profile_type=CUSTOMER&person_status=active&recover_legacy_id=true&textual_search_only=true`;
    const headers = {
        'x-authorization': authToken,
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    };
    const res = await fetch(url, { headers });
    if (res.status !== 200) {
        throw new Error(`Erro ao buscar client (HTTP ${res.status})`);
    }
    const json = await res.json();
    return json.items || [];
}

async function buscarCategoriasVenda(authToken, searchTerm) {
    const url = `https://services.contaazul.com/app/financialCategory/autocomplete?page=0&pageSize=20&textualSearch=${encodeURIComponent(searchTerm)}&type=RECEITA&financeOrigin=SALES`;
    const headers = {
        'x-authorization': authToken,
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    };
    const res = await fetch(url, { headers });
    if (res.status !== 200) {
        throw new Error(`Erro ao buscar categoria (HTTP ${res.status})`);
    }
    const json = await res.json();
    return json.data || [];
}

async function buscarItemsVenda(authToken, searchTerm) {
    const url = `https://services.contaazul.com/inventory/v1/products?page=1&page_size=20&search=${encodeURIComponent(searchTerm)}&serviceType=PROVIDED&searchProductKitEnabled=true`;
    const headers = {
        'x-authorization': authToken,
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    };
    const res = await fetch(url, { headers });
    if (res.status !== 200) {
        throw new Error(`Erro ao buscar item (HTTP ${res.status})`);
    }
    const json = await res.json();
    return json.items || [];
}

async function calcularImpostosVenda(authToken, itemId, unitValue, cityId, isLegalPerson, isPublicAgency) {
    const url = 'https://services.contaazul.com/invoice-tax-management/v1/calculate-taxes';
    const headers = {
        'x-authorization': authToken,
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    };
    const body = {
        key: 1,
        provider: { taxationRegime: 'SIMPLE_NATIONAL', nationalPattern: false },
        taker: {
            type: isLegalPerson ? 'LEGAL_PERSON' : 'NATURAL_PERSON',
            taxationRegime: 'NORMAL',
            publicAgency: isPublicAgency
        },
        service: {
            id: itemId,
            values: { base: unitValue },
            provisionPlace: { cityId: cityId },
            taxes: { iss: { roundingMode: 'HALF_EVEN' } }
        }
    };
    const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
    });
    if (res.status !== 200) {
        throw new Error(`Erro ao calcular impostos (HTTP ${res.status})`);
    }
    return await res.json();
}

async function obterNaturesOperacao(authToken) {
    const url = 'https://services.contaazul.com/contaazul-bff/sale/v1/sales-operation-natures';
    const headers = {
        'x-authorization': authToken,
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    };
    const res = await fetch(url, { headers });
    if (res.status !== 200) {
        throw new Error(`Erro ao buscar naturezas de operação (HTTP ${res.status})`);
    }
    const json = await res.json();
    return json.items || [];
}

async function obterProximoNumeroVenda(authToken) {
    const url = 'https://services.contaazul.com/app/v1/negotiations/next-number';
    const headers = {
        'x-authorization': authToken,
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    };
    const res = await fetch(url, { headers });
    if (res.status !== 200) {
        throw new Error(`Erro ao obter próximo número de venda (HTTP ${res.status})`);
    }
    const json = await res.json();
    return json.data;
}

async function criarVendaServico(authToken, payload) {
    const url = 'https://services.contaazul.com/app/v1/sales/';
    const headers = {
        'x-authorization': authToken,
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    };
    const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
    });
    if (res.status !== 200) {
        const text = await res.text();
        throw new Error(`Erro ao criar venda de serviço (HTTP ${res.status}): ${text}`);
    }
    return await res.json();
}

async function obterEventoFinanceiroPorRef(authToken, saleId) {
    const url = `https://services.contaazul.com/finance-pro/v1/financial-events?reference_id=${saleId}`;
    const headers = {
        'x-authorization': authToken,
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    };
    const res = await fetch(url, { headers });
    if (res.status !== 200) {
        throw new Error(`Erro ao obter evento financeiro da venda (HTTP ${res.status})`);
    }
    const json = await res.json();
    return json.items || [];
}

async function obterDetalhesPessoa(authToken, personUuid) {
    const url = `https://services.contaazul.com/contaazul-bff/person-registration/v1/persons/${personUuid}`;
    const headers = {
        'x-authorization': authToken,
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    };
    const res = await fetch(url, { headers });
    if (res.status !== 200) {
        throw new Error(`Erro ao obter detalhes da pessoa (HTTP ${res.status})`);
    }
    return await res.json();
}

async function enviarNotificacaoCobranca(authToken, payload) {
    const url = 'https://services.contaazul.com/finance-pro/v1/charge-notifications';
    const headers = {
        'x-authorization': authToken,
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    };
    const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
    });
    if (res.status !== 201 && res.status !== 200) {
        const text = await res.text();
        throw new Error(`Erro ao enviar notificação de cobrança (HTTP ${res.status}): ${text}`);
    }
    return true;
}

async function obterEmpresaDetails(authToken) {
    const url = 'https://services.contaazul.com/contaazul-bff/account/v1/company-details-edit';
    const headers = {
        'x-authorization': authToken,
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    };
    const res = await fetch(url, { headers });
    if (res.status !== 200) {
        throw new Error(`Erro ao obter detalhes da empresa (HTTP ${res.status})`);
    }
    return await res.json();
}

async function downloadBoletoViaExtrato(authToken, saleNumber, value, customerName, downloadPath) {
    console.log(`\n  Buscando o lançamento de "Venda ${saleNumber}" no extrato de movimentações para download...`);
    const maxTentativas = 20;
    const delayMs = 3000;
    
    for (let i = 1; i <= maxTentativas; i++) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
        try {
            const movimentacoes = await obterMovimentacoes(authToken, `Venda ${saleNumber}`);
            // Procurar o lançamento correspondente
            const match = movimentacoes.find(m => {
                const desc = (m.description || '').toLowerCase();
                const isMatchDesc = desc.includes(`venda ${saleNumber}`);
                const isMatchValue = Math.abs(m.value - value) < 0.01;
                return isMatchDesc || isMatchValue;
            });
            
            if (match) {
                if (match.chargeRequest && match.chargeRequest.id && match.chargeRequest.url) {
                    console.log(`\n  ✓ Lançamento encontrado no extrato com boleto emitido!`);
                    console.log(`  ID da Cobrança: ${match.chargeRequest.id}`);
                    console.log(`  URL do Boleto: ${match.chargeRequest.url}`);
                    
                    // Baixar
                    await downloadBoleto(authToken, customerName, match.chargeRequest.id, match.chargeRequest.url, downloadPath);
                    return downloadPath;
                } else {
                    process.stdout.write(`  [Tentativa ${i}/${maxTentativas}] Lançamento encontrado no extrato, mas boleto ainda não associado ou URL nula. Aguardando...\r`);
                }
            } else {
                process.stdout.write(`  [Tentativa ${i}/${maxTentativas}] Lançamento "Venda ${saleNumber}" não encontrado no extrato ainda. Aguardando...\r`);
            }
        } catch (err) {
            console.error(`\n⚠️ Erro na tentativa ${i} de busca no extrato:`, err.message);
        }
    }
    throw new Error(`Não foi possível localizar o boleto para a "Venda ${saleNumber}" no extrato após ${maxTentativas} tentativas.`);
}

async function criarVendaServicoFluxo(authToken, state, clientePreSelecionado = null) {
    console.log('\n========================================================================');
    console.log('             GERAR NOVA VENDA DE SERVIÇO E EMITIR BOLETO');
    console.log('========================================================================');

    // 1. Cliente
    let clienteFinal = clientePreSelecionado;
    while (!clienteFinal) {
        const termoCliente = await ask('Digite o nome do cliente para pesquisa (ou "novo" para cadastrar): ');
        if (!termoCliente.trim()) {
            console.log('❌ O nome do cliente é obrigatório.');
            continue;
        }

        if (termoCliente.toLowerCase().trim() === 'novo') {
            const novoCliente = await cadastrarNovoClienteFluxo(authToken, state);
            if (!novoCliente) {
                continue;
            }
            const seguir = await ask('Deseja seguir com a criação do boleto para este novo cliente (Venda de Serviço) [s/n]? ');
            if (seguir.toLowerCase().trim() === 's') {
                clienteFinal = novoCliente;
                break;
            } else {
                return;
            }
        }

        console.log('  Buscando cliente...');
        const clientesEncontrados = await buscarClientesVenda(authToken, termoCliente);
        if (clientesEncontrados.length === 0) {
            console.log('⚠️ Nenhum cliente semelhante encontrado.');
            const cadastrarNovo = await ask('Deseja cadastrar um novo cliente? (s/n): ');
            if (cadastrarNovo.toLowerCase().trim() === 's') {
                const novoCliente = await cadastrarNovoClienteFluxo(authToken, state);
                if (novoCliente) {
                    const seguir = await ask('Deseja seguir com a criação do boleto para este novo cliente (Venda de Serviço) [s/n]? ');
                    if (seguir.toLowerCase().trim() === 's') {
                        clienteFinal = novoCliente;
                        break;
                    } else {
                        return;
                    }
                }
            }
            continue;
        }
        
        console.log('\nClientes encontrados semelhantes:');
        clientesEncontrados.forEach((c, idx) => {
            console.log(`  [${idx + 1}] ${c.name} (CNPJ/CPF: ${c.document || 'N/A'})`);
        });
        console.log('  [novo] + Novo (Cadastrar Novo Cliente)');
        console.log('');
        
        const opcao = await ask(`Escolha o número do cliente (1 a ${clientesEncontrados.length}), "novo" para cadastrar, ou "voltar": `);
        if (opcao.toLowerCase().trim() === 'voltar') {
            return;
        }
        if (opcao.toLowerCase().trim() === 'novo') {
            const novoCliente = await cadastrarNovoClienteFluxo(authToken, state);
            if (!novoCliente) {
                continue;
            }
            const seguir = await ask('Deseja seguir com a criação do boleto para este novo cliente (Venda de Serviço) [s/n]? ');
            if (seguir.toLowerCase().trim() === 's') {
                clienteFinal = novoCliente;
                break;
            } else {
                return;
            }
        }
        const idx = parseInt(opcao, 10) - 1;
        if (isNaN(idx) || idx < 0 || idx >= clientesEncontrados.length) {
            console.log('❌ Opção inválida.');
            continue;
        }
        clienteFinal = clientesEncontrados[idx];
    }
    console.log(`✓ Cliente selecionado: ${clienteFinal.name}`);

    // Buscar detalhes da pessoa (para pegar cityId, address, etc.)
    console.log('  Carregando detalhes do cliente...');
    const clienteDetalhado = await obterDetalhesPessoa(authToken, clienteFinal.id);

    // 2. Categoria Financeira
    let categoriaFinal = null;
    while (!categoriaFinal) {
        const termoCategoria = await ask('Digite a categoria financeira para pesquisa: ');
        if (!termoCategoria.trim()) {
            console.log('❌ A categoria financeira é obrigatória.');
            continue;
        }
        console.log('  Buscando categoria...');
        const categoriasEncontradas = await buscarCategoriasVenda(authToken, termoCategoria);
        if (categoriasEncontradas.length === 0) {
            console.log('⚠️ Nenhuma categoria semelhante encontrada. Tente novamente.');
            continue;
        }
        
        console.log('\nCategorias encontradas semelhantes:');
        categoriasEncontradas.forEach((cat, idx) => {
            console.log(`  [${idx + 1}] ${cat.dsNaturezaFinanceira}`);
        });
        console.log('');
        
        const opcao = await ask(`Escolha o número da categoria (1 a ${categoriasEncontradas.length}, ou "voltar"): `);
        if (opcao.toLowerCase().trim() === 'voltar') {
            return;
        }
        const idx = parseInt(opcao, 10) - 1;
        if (isNaN(idx) || idx < 0 || idx >= categoriasEncontradas.length) {
            console.log('❌ Opção inválida.');
            continue;
        }
        categoriaFinal = categoriasEncontradas[idx];
    }
    console.log(`✓ Categoria selecionada: ${categoriaFinal.dsNaturezaFinanceira}`);

    // 3. Item de Serviço
    let itemFinal = null;
    while (!itemFinal) {
        const termoItem = await ask('Digite o item de serviço para pesquisa: ');
        if (!termoItem.trim()) {
            console.log('❌ O item de serviço é obrigatório.');
            continue;
        }
        console.log('  Buscando item de serviço...');
        const itemsEncontrados = await buscarItemsVenda(authToken, termoItem);
        if (itemsEncontrados.length === 0) {
            console.log('⚠️ Nenhum item semelhante encontrado. Tente novamente.');
            continue;
        }
        
        console.log('\nItens de serviço encontrados semelhantes:');
        itemsEncontrados.forEach((item, idx) => {
            console.log(`  [${idx + 1}] ${item.name} (Valor padrão: R$ ${item.saleValue?.toFixed(2) || '0.00'})`);
        });
        console.log('');
        
        const opcao = await ask(`Escolha o número do item (1 a ${itemsEncontrados.length}, ou "voltar"): `);
        if (opcao.toLowerCase().trim() === 'voltar') {
            return;
        }
        const idx = parseInt(opcao, 10) - 1;
        if (isNaN(idx) || idx < 0 || idx >= itemsEncontrados.length) {
            console.log('❌ Opção inválida.');
            continue;
        }
        itemFinal = itemsEncontrados[idx];
    }
    console.log(`✓ Item selecionado: ${itemFinal.name}`);

    // 4. Detalhes do Item
    const detalhesItem = await ask('Digite os detalhes do item: ');

    // 5. Valor Unitário
    let valorUnitario = 0;
    while (true) {
        const valorStr = await ask('Digite o valor unitário (ex: 10,00 ou 10.00): ');
        const valorLimpo = valorStr.replace(/\s/g, '').replace(',', '.');
        const parsed = parseFloat(valorLimpo);
        if (!isNaN(parsed) && parsed > 0) {
            valorUnitario = parsed;
            break;
        }
        console.log('❌ Valor unitário inválido.');
    }

    // 6. Vencimento
    let vencimentoIso = null;
    let dataVencimentoBr = null;
    while (!vencimentoIso) {
        dataVencimentoBr = await ask('Digite a data de vencimento (dd/mm/aaaa): ');
        const dateObj = parseDate(dataVencimentoBr);
        if (!dateObj) {
            console.log('❌ Data de vencimento inválida.');
            continue;
        }
        const ano = dateObj.getFullYear();
        const mes = String(dateObj.getMonth() + 1).padStart(2, '0');
        const dia = String(dateObj.getDate()).padStart(2, '0');
        vencimentoIso = `${ano}-${mes}-${dia}`;
    }

    // Obter data de hoje para a venda
    const hoje = new Date();
    const anoHoje = hoje.getFullYear();
    const mesHoje = String(hoje.getMonth() + 1).padStart(2, '0');
    const diaHoje = String(hoje.getDate()).padStart(2, '0');
    const dataVendaIso = `${anoHoje}-${mesHoje}-${diaHoje}`;

    // 7. Calcular Impostos
    console.log('  Calculando impostos...');
    const cityId = clienteDetalhado.address?.[0]?.idCity || 2174;
    const isLegalPerson = clienteDetalhado.personType === 'Jurídica';
    const isPublicAgency = clienteDetalhado.isPublicAgency || false;
    
    let taxResponse = null;
    try {
        taxResponse = await calcularImpostosVenda(authToken, itemFinal.id, valorUnitario, cityId, isLegalPerson, isPublicAgency);
    } catch (e) {
        console.log('  ⚠️ Não foi possível calcular impostos. Prosseguindo com dados padrões de impostos.');
    }

    // Obter naturezas de operação para encontrar Prestação de Serviço
    console.log('  Verificando naturezas de operação...');
    const naturezas = await obterNaturesOperacao(authToken);
    let natureUuid = '6825691e-aa5a-11ee-b946-07b8dd7a01a3'; // Fallback
    const prestacaoNature = naturezas.find(n => n.operationTemplate === 'PRESTACAO_SERVICO');
    if (prestacaoNature) {
        natureUuid = prestacaoNature.uuid;
    }

    // Obter o próximo número de venda
    console.log('  Obtendo próximo número de venda...');
    const proximoNumero = await obterProximoNumeroVenda(authToken);

    // 8. Criar a Venda
    console.log('  Criando a venda no Conta Azul...');
    const salePayload = {
        customerId: clienteDetalhado.uuid,
        number: proximoNumero,
        suggestedNumber: proximoNumero,
        committedDate: dataVendaIso,
        categoryId: categoriaFinal.uuid,
        operationNatureId: natureUuid,
        saleItems: [
            {
                description: detalhesItem,
                amount: 1,
                value: valorUnitario,
                id: itemFinal.id,
                costValue: 0,
                priceAdjustmentMethod: null
            }
        ],
        valueComposition: { shipping: 0, discount: { type: 'VALUE', value: 0 }, serviceTaxTotal: 0 },
        paymentCondition: {
            paymentType: 'BANKING_BILLET',
            financialAccountId: 'cf6eedce-10e8-4554-b707-9246826b12c6',
            paymentConditionOption: '1x',
            installments: [{ dueDate: vencimentoIso, value: valorUnitario }]
        },
        observations: '',
        invoiceObservations: '',
        situation: 'APPROVED',
        automation: { serviceInvoiceEmission: { type: 'PAYMENT_IDENTIFICATION', active: false } },
        originFlowType: 'SIMPLIFIED_SALE'
    };

    if (taxResponse && taxResponse.service) {
        salePayload.serviceTaxInformation = {
            id: itemFinal.id,
            values: taxResponse.service.values,
            taxes: taxResponse.service.taxes,
            provisionPlace: taxResponse.service.provisionPlace
        };
    }

    const createdSale = await criarVendaServico(authToken, salePayload);
    const saleId = createdSale.id;
    const saleNumber = createdSale.number || proximoNumero;
    console.log(`✓ Venda de serviço ${saleNumber} criada com sucesso!`);

    // 9. Obter Evento Financeiro e ID da Parcela
    console.log('  Aguardando criação do lançamento financeiro correspondente...');
    let installment = null;
    let financialEventId = null;
    for (let t = 0; t < 10; t++) {
        await new Promise(r => setTimeout(r, 2000));
        try {
            const evs = await obterEventoFinanceiroPorRef(authToken, saleId);
            if (evs && evs.length > 0) {
                financialEventId = evs[0].id;
                installment = evs[0].paymentCondition?.installments?.[0];
                if (installment) break;
            }
        } catch (e) {
            // Tenta novamente
        }
    }

    if (!installment) {
        throw new Error('Falha ao obter a parcela do lançamento financeiro correspondente à venda.');
    }

    // 10. Configurar Cobrança / Lembretes de Vencimento
    console.log('\n--- CONFIGURAÇÃO DE LEMBRETES DE COBRANÇA (WhatsApp + SMS + E-mail) ---');
    
    // Obter dados pré-preenchidos de contato
    let emailCobrancaDefault = clienteDetalhado.billingContact?.emails?.[0] || clienteDetalhado.email || '';
    let celularCobrancaDefault = clienteDetalhado.billingContact?.phoneNumber || clienteDetalhado.commercialPhone || '';
    
    // Email do cliente
    let emailFinal = '';
    if (emailCobrancaDefault) {
        console.log(`E-mail do cliente encontrado: ${emailCobrancaDefault}`);
        const emailOpcao = await ask(`Deseja manter o e-mail ou alterar? (Pressione Enter para manter ou digite o novo): `);
        emailFinal = emailOpcao.trim() || emailCobrancaDefault;
    } else {
        while (!emailFinal) {
            const emailOpcao = await ask(`❌ Nenhum e-mail de cobrança cadastrado. Digite o e-mail do cliente: `);
            emailFinal = emailOpcao.trim();
        }
    }

    // Celular do cliente
    let celularFinal = '';
    if (celularCobrancaDefault) {
        console.log(`Celular do cliente encontrado: ${celularCobrancaDefault}`);
        const celularOpcao = await ask(`Deseja manter o celular ou alterar? (Pressione Enter para manter ou digite o novo): `);
        celularFinal = celularOpcao.trim().replace(/\D/g, '') || celularCobrancaDefault.replace(/\D/g, '');
    } else {
        while (!celularFinal) {
            const celularOpcao = await ask(`❌ Nenhum celular de cobrança cadastrado. Digite o celular com DDD (apenas números): `);
            celularFinal = celularOpcao.trim().replace(/\D/g, '');
        }
    }

    // Emitir cobrança
    console.log('  Emitindo cobrança com lembrete WhatsApp + SMS + E-mail...');
    const batchCreatePayload = {
        financialAccountId: 'cf6eedce-10e8-4554-b707-9246826b12c6', // default Conta PJ
        installmentGroups: [{
            originalDescription: `Venda ${saleNumber}`,
            description: `Venda ${saleNumber} - 1/1`,
            installmentIds: [{ id: installment.id, version: installment.version || 0 }],
            dueDate: vencimentoIso,
            value: valorUnitario,
            index: 1
        }],
        type: 'RECEBA_FACIL_BANK_SLIP',
        customAttributes: { charge: { type: 'INVOICE' } },
        notification: {
            emails: [emailFinal.toUpperCase()],
            scheduled: true,
            instantSending: false,
            smsNumbers: [celularFinal],
            whatsappNumbers: [celularFinal]
        }
    };

    const batchCreateRes = await fetch('https://services.contaazul.com/finance-pro/v2/charge-requests/batch-create', {
        method: 'POST',
        headers: {
            'x-authorization': authToken,
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/plain, */*',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        },
        body: JSON.stringify(batchCreatePayload)
    });

    if (batchCreateRes.status !== 200) {
        const txt = await batchCreateRes.text();
        throw new Error(`Erro ao emitir boleto (HTTP ${batchCreateRes.status}): ${txt}`);
    }

    const batchCreateJson = await batchCreateRes.json();
    const chargeRequest = batchCreateJson.items?.[0];
    if (!chargeRequest || !chargeRequest.id) {
        throw new Error('Falha ao obter ID da cobrança gerada.');
    }
    console.log(`✓ Cobrança criada com sucesso! ID: ${chargeRequest.id}`);

    // 11. Sucesso e Email de contato do destinatário
    console.log('\n--- CONFIRMAÇÃO DE ENVIO ---');
    const defaultReplyTo = 'sccontabilidadefinanceiro@gmail.com';
    const replyToOpcao = await ask(`E-mail para o destinatário entrar em contato [default: "${defaultReplyTo}"]: `);
    const replyToFinal = replyToOpcao.trim() || defaultReplyTo;

    // Obter detalhes da nossa própria empresa para o subject/body do email
    console.log('  Obtendo dados da nossa empresa...');
    let companyName = 'MAIS NEGOCIOS ASSESSORIA CONTABIL LTDA';
    try {
        const comp = await obterEmpresaDetails(authToken);
        companyName = comp.fantasyName || comp.name || companyName;
    } catch (e) {}

    // Enviar cobrança
    console.log('  Enviando e-mail de cobrança...');
    const bodyText = `Olá, ${clienteDetalhado.name}.<br><br>Você acaba de receber 1 cobrança no valor total de R$ ${valorUnitario.toFixed(2).replace('.', ',')}, emitida por ${companyName}. Confira os detalhes:<br>- R$ ${valorUnitario.toFixed(2).replace('.', ',')} com vencimento em ${dataVencimentoBr}, referente a: Venda ${saleNumber} - 1/1`;
    
    const notificationPayload = {
        body: bodyText,
        emails: [emailFinal],
        selfNotification: false,
        scheduled: false,
        subject: `[Importante] Chegou sua fatura de ${companyName}`,
        replyTo: replyToFinal,
        instantSending: true,
        chargeRequestIds: [chargeRequest.id]
    };

    await enviarNotificacaoCobranca(authToken, notificationPayload);
    console.log('✓ E-mail de cobrança enviado com sucesso!');

    // 12. Download do boleto via extrato de movimentações
    const cleanClientName = clienteDetalhado.name.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30);
    const pdfFilename = `boleto_${cleanClientName}_venda_${saleNumber}.pdf`;
    
    const downloadDir = path.resolve(__dirname, 'downloads');
    if (!fs.existsSync(downloadDir)) {
        fs.mkdirSync(downloadDir, { recursive: true });
    }
    const downloadPath = path.join(downloadDir, pdfFilename);
    
    await downloadBoletoViaExtrato(authToken, saleNumber, valorUnitario, clienteDetalhado.name, downloadPath);
}

async function main() {
    console.log('\n╔══════════════════════════════════════════════════════════════════════╗');
    console.log('║             CONTA AZUL - EXTRATO DE MOVIMENTAÇÕES INTERATIVO         ║');
    console.log('╚══════════════════════════════════════════════════════════════════════╝');

    const statePath = path.resolve(__dirname, 'state.json');
    if (!fs.existsSync(statePath)) {
        console.error('\n[ERRO] Arquivo "state.json" não encontrado.');
        console.error('Por favor, rode "node contaazul/capture.js" primeiro para se autenticar.');
        process.exit(1);
    }

    // Carregar estado de login do Conta Azul Mais
    const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));

    console.log('Carregando clientes ativos...');
    let clientes = [];
    try {
        clientes = await obterClientes(state);
        console.log(`✓ ${clientes.length} clientes ativos carregados com sucesso!`);
    } catch (err) {
        console.error('❌ Erro ao listar clientes ativos:', err.message);
        process.exit(1);
    }

    while (true) {
        console.log('\n------------------------------------------------------------------------');
        console.log('Opções do sistema:');
        console.log('  [1] Pesquisar cliente e listar extrato (Alterar vencimento e reemitir)');
        console.log('  [2] Emitir Novo Boleto de Serviço (Nova Venda de Serviço)');
        console.log('  [3] Cadastrar Novo Cliente');
        console.log('  [sair] Sair do sistema');
        console.log('');

        const acao = await ask('Opção: ');

        if (acao.toLowerCase().trim() === 'sair') {
            console.log('\nSaindo do sistema. Até logo!');
            rl.close();
            break;
        }

        if (acao !== '1' && acao !== '2' && acao !== '3') {
            console.log('❌ Opção inválida.');
            continue;
        }

        // Exibir todos os clientes/empresas cadastrados para seleção direta
        if (clientes.length === 0) {
            console.log('❌ Nenhum cliente ativo encontrado.');
            continue;
        }

        console.log('\nClientes/Empresas do Conta Azul:');
        clientes.forEach((c, idx) => {
            console.log(`  [${idx + 1}] ${c.name} (Tenant: ${c.tenantId})`);
        });
        console.log('');

        const opcao = await ask(`Selecione o número do cliente (1 a ${clientes.length}, ou "voltar"): `);
        if (opcao.toLowerCase().trim() === 'voltar') {
            continue;
        }
        const idx = parseInt(opcao, 10) - 1;

        if (isNaN(idx) || idx < 0 || idx >= clientes.length) {
            console.log('❌ Opção inválida.');
            continue;
        }
        const clienteSelecionado = clientes[idx];
        console.log(`✓ Cliente selecionado: ${clienteSelecionado.name} (Tenant: ${clienteSelecionado.tenantId})`);

        // Alternar sessão e obter o token Pro do cliente
        let authToken = null;
        try {
            authToken = await obterAuthTokenClienteHTTP(clienteSelecionado.relationId, state);
            if (!authToken) {
                console.log('❌ Erro: Não foi possível obter o auth-token da sessão.');
                continue;
            }
        } catch (err) {
            console.error('❌ Falha ao obter a sessão do cliente:', err.message);
            continue;
        }

        if (acao === '1') {
            // Solicitar termo de pesquisa para o extrato (obrigatório)
            let termoBusca = '';
            while (true) {
                termoBusca = await ask('\nDigite o nome ou termo para pesquisar no extrato: ');
                if (termoBusca.trim()) {
                    break;
                }
                console.log('❌ O nome/termo de pesquisa é obrigatório. Por favor, tente novamente.');
            }

            // Buscar movimentações financeiras por HTTP
            try {
                const movimentacoes = await obterMovimentacoes(authToken, termoBusca);
                
                // Filtrar localmente pelo termo de pesquisa sem qualquer outro tipo de filtro
                const query = termoBusca.toLowerCase().trim();
                const filteredMovs = movimentacoes.filter(m => {
                    const desc = (m.description || '').toLowerCase();
                    const negotiator = (m.negotiator?.name || '').toLowerCase();
                    const cat = (m.categoryName || '').toLowerCase();
                    const financialEventDesc = (m.financialEvent?.description || '').toLowerCase();
                    const bankAccountName = (m.financialAccount?.name || '').toLowerCase();
                    
                    return desc.includes(query) || 
                           negotiator.includes(query) || 
                           cat.includes(query) || 
                           financialEventDesc.includes(query) || 
                           bankAccountName.includes(query);
                });

                console.log(`\n✓ Total de lançamentos correspondentes encontrados: ${filteredMovs.length}`);
                
                if (filteredMovs.length > 0) {
                    console.log('\nExtrato de Movimentações:');
                    console.log('-------------------------------------------------------------------------------------------------------------------------------------------------------------------------');
                    console.log(
                        '     | ' +
                        'DATA'.padEnd(12) + ' | ' +
                        'CLIENTE'.padEnd(30) + ' | ' +
                        'DESCRIÇÃO'.padEnd(30) + ' | ' +
                        'VALOR'.padEnd(12) + ' | ' +
                        'STATUS LANÇ.'.padEnd(14) + ' | ' +
                        'BOLETO (STATUS)'.padEnd(25) + ' | ' +
                        'CATEGORIA'
                    );
                    console.log('-------------------------------------------------------------------------------------------------------------------------------------------------------------------------');
                    
                    // Ordenar por data decrescente
                    filteredMovs.sort((a, b) => b.date.localeCompare(a.date));

                    filteredMovs.forEach((m, idx) => {
                        const idxStr = `[${idx + 1}]`.padEnd(5);
                        const dataFormatada = formatDateBr(m.date);
                        
                        const clientName = m.negotiator?.name || 'N/A';
                        const clientTruncated = clientName.length > 27 ? clientName.substring(0, 27) + '...' : clientName;
                        
                        const desc = m.description.length > 27 ? m.description.substring(0, 27) + '...' : m.description;
                        const valorStr = `R$ ${m.value.toFixed(2)}`;
                        const status = m.status === 'ACQUITTED' ? 'LIQUIDADO' : 'ABERTO';
                        
                        let boletoStr = 'SEM BOLETO';
                        if (m.chargeRequest) {
                            const statusBoleto = m.chargeRequest.status || 'N/A';
                            const idBoleto = m.chargeRequest.id ? m.chargeRequest.id.substring(0, 8) : '';
                            boletoStr = `${statusBoleto} (${idBoleto})`;
                        }
                        
                        const categoria = m.categoryName || 'N/A';

                        console.log(
                            idxStr + ' | ' +
                            dataFormatada.padEnd(12) + ' | ' +
                            clientTruncated.padEnd(30) + ' | ' +
                            desc.padEnd(30) + ' | ' +
                            valorStr.padEnd(12) + ' | ' +
                            status.padEnd(14) + ' | ' +
                            boletoStr.padEnd(25) + ' | ' +
                            categoria
                        );
                    });
                    console.log('-------------------------------------------------------------------------------------------------------------------------------------------------------------------------');

                    console.log('\nOpções de lançamentos:');
                    console.log('  [número] Selecionar um lançamento para editar vencimento e emitir boleto');
                    console.log('  [voltar] Voltar para a pesquisa de clientes');
                    console.log('');
                    
                    const opcaoLancamento = await ask(`Selecione o número do lançamento (1 a ${filteredMovs.length}, ou "voltar"): `);
                    if (opcaoLancamento.toLowerCase().trim() !== 'voltar') {
                        const lIdx = parseInt(opcaoLancamento, 10) - 1;
                        if (!isNaN(lIdx) && lIdx >= 0 && lIdx < filteredMovs.length) {
                            const lancamentoSelecionado = filteredMovs[lIdx];
                            try {
                                await processarFluxoLancamento(authToken, lancamentoSelecionado, state);
                            } catch (err) {
                                console.error('\n❌ Erro ao processar o fluxo do lançamento:', err.message);
                            }
                        } else {
                            console.log('❌ Opção inválida.');
                        }
                    }
                } else {
                    console.log(`⚠️ Nenhum lançamento encontrado com o termo "${termoBusca}".`);
                }
            } catch (err) {
                console.error('❌ Erro ao recuperar movimentações:', err.message);
            }
        } else if (acao === '2') {
            try {
                await criarVendaServicoFluxo(authToken, state);
            } catch (err) {
                console.error('\n❌ Erro ao processar criação de venda e boleto:', err.message);
            }
        } else if (acao === '3') {
            try {
                const novoCliente = await cadastrarNovoClienteFluxo(authToken, state);
                if (novoCliente) {
                    const seguir = await ask('Deseja seguir com a criação do boleto para este novo cliente (Venda de Serviço) [s/n]? ');
                    if (seguir.toLowerCase().trim() === 's') {
                        await criarVendaServicoFluxo(authToken, state, novoCliente);
                    }
                }
            } catch (err) {
                console.error('\n❌ Erro ao processar cadastro de cliente:', err.message);
            }
        }
    }
}

main().catch(err => {
    console.error('Erro geral no sistema:', err.message);
    process.exit(1);
});

