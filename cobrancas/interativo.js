/**
 * ASAAS - Sistema Interativo de Cobranças (Busca & Edição)
 * 
 * Permite buscar clientes por nome, listar suas cobranças pendentes,
 * alterar o vencimento e gerar o link do boleto/fatura.
 * 
 * Uso:
 *   node cobrancas/interativo.js
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const readline = require('readline');
const fs = require('fs');

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

const CACHE_PATH = path.join(__dirname, 'clientes_cache.json');

// Função para buscar todos os clientes paginados da API do Asaas
async function carregarTodosClientesDaAPI() {
    let todos = [];
    let offset = 0;
    const max = 50;

    console.log('  Iniciando sincronização completa de clientes...');
    while (true) {
        const url = `${BASE_URL}/customerAccount/loadTableContent?offset=${offset}&max=${max}`;
        const res = await fetch(url, { headers: getHeaders() });
        if (res.status !== 200) {
            console.error(`  Erro ao listar clientes: HTTP ${res.status}`);
            break;
        }

        const json = await res.json();
        const content = json.content || '';

        const rowRegex = /data-id="(\d+)"[\s\S]*?<atlas-text bold>(.*?)<\/atlas-text>/g;
        const lote = [];
        let match;
        while ((match = rowRegex.exec(content)) !== null) {
            lote.push({
                id: match[1],
                nome: decodeHTML(match[2].trim())
            });
        }

        if (lote.length === 0) break;
        todos = todos.concat(lote);
        
        process.stdout.write(`\r  Carregados ${todos.length} clientes...`);

        offset += max;
        if (lote.length < max) break;
    }
    console.log('\n  Sincronização concluída!');
    return todos;
}

// Obter lista de clientes usando cache local
async function obterClientes(forcarAtualizacao = false) {
    let usarCache = false;

    if (fs.existsSync(CACHE_PATH) && !forcarAtualizacao) {
        const stats = fs.statSync(CACHE_PATH);
        const idadeHoras = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60);
        
        // Se o cache tiver menos de 24 horas, usamos o cache
        if (idadeHoras < 24) {
            usarCache = true;
        } else {
            console.log('⚠️ O cache local tem mais de 24 horas. Atualizando...');
        }
    }

    if (usarCache) {
        try {
            const data = fs.readFileSync(CACHE_PATH, 'utf-8');
            return JSON.parse(data);
        } catch (err) {
            console.log('⚠️ Erro ao ler cache. Recarregando da API...');
        }
    }

    // Carregar da API e salvar no cache
    const clientes = await carregarTodosClientesDaAPI();
    if (clientes.length > 0) {
        fs.writeFileSync(CACHE_PATH, JSON.stringify(clientes, null, 2), 'utf-8');
    }
    return clientes;
}

// Buscar clientes filtrados
async function buscarClientes(query = '', forcarAtualizacao = false) {
    const clientes = await obterClientes(forcarAtualizacao);
    
    if (query.trim() !== '') {
        const q = query.toLowerCase().trim();
        return clientes.filter(c => c.nome.toLowerCase().includes(q));
    }
    return clientes;
}

// Buscar e filtrar cobranças de um cliente específico
async function obterCobrancasPendentes(clienteId) {
    const url = `${BASE_URL}/paymentList/loadTableContent?customerAccountId=${clienteId}&offset=0&max=100`;
    const res = await fetch(url, { headers: getHeaders() });

    if (res.status !== 200) {
        console.error(`Erro ao listar cobranças: HTTP ${res.status}`);
        return [];
    }

    const json = await res.json();
    const content = json.content || '';

    // Dividir pelas linhas da tabela
    const rows = content.split('data-payment-id="');
    const cobrancas = [];

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const id = row.substring(0, row.indexOf('"'));
        
        // Extrair tooltip (status)
        const tooltipMatch = row.match(/tooltip="([^"]+)"/);
        const status = tooltipMatch ? tooltipMatch[1] : 'Desconhecido';

        // Filtrar apenas "Aguardando pagamento"
        if (status.toLowerCase() !== 'aguardando pagamento') {
            continue;
        }

        // Extrair valor
        const valueMatch = row.match(/R\$\s*[\d.,]+/);
        const valor = valueMatch ? valueMatch[0] : 'R$ 0,00';

        // Extrair data de vencimento
        const dateMatch = row.match(/(\d{2}\/\d{2}\/\d{4})/);
        const vencimento = dateMatch ? dateMatch[0] : 'N/A';

        cobrancas.push({ id, valor, vencimento, status });
    }

    return cobrancas;
}

// Salvar/Editar a cobrança com nova data de vencimento
async function salvarVencimento(id, novaData) {
    const formData = new URLSearchParams();
    formData.append('id', id);
    formData.append('dueDate', novaData);

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
        return true;
    }
    return false;
}

// Criar uma nova cobrança com as 3 constantes fixas (Boleto, 2% juros, 1% multa)
async function criarCobrancaParaCliente(customerAccountId, valor, vencimento, descricao) {
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
        return await res.json().catch(() => null);
    } else {
        const text = await res.text();
        console.error(`Erro na API (HTTP ${res.status}):`, text.substring(0, 500));
        return null;
    }
}

// Buscar os links do boleto após salvar
async function obterLinksBoleto(id) {
    const url = `${BASE_URL}/payment/show/${id}`;
    const res = await fetch(url, { headers: getHeaders() });

    if (res.status !== 200) {
        return null;
    }

    const html = await res.text();
    const boletoLinkMatch = html.match(/class="js-boleto-link"\s*value="([^"]*)"/i) || html.match(/value="([^"]*)"\s*class="js-boleto-link"/i);
    const faturaLinkMatch = html.match(/href="\/i\/([^"]*)"/i) || html.match(/href=['"]\/i\/([^'"]*)['"]/i);

    const links = {
        boleto: null,
        fatura: null,
        token: null
    };

    if (boletoLinkMatch) {
        links.boleto = `${BASE_URL}${boletoLinkMatch[1]}`;
        const parts = boletoLinkMatch[1].split('/');
        links.token = parts[parts.length - 1];
    }
    if (faturaLinkMatch) {
        links.fatura = `${BASE_URL}/i/${faturaLinkMatch[1]}`;
        if (!links.token) links.token = faturaLinkMatch[1];
    } else if (boletoLinkMatch) {
        const parts = boletoLinkMatch[1].split('/');
        const token = parts[parts.length - 1];
        if (token) {
            links.fatura = `${BASE_URL}/i/${token}`;
            if (!links.token) links.token = token;
        }
    }

    return links;
}

// Baixar o PDF do boleto e salvar localmente
async function baixarPDFBoleto(externalToken, filename) {
    const url = `${BASE_URL}/b/pdf/${externalToken}`;
    console.log(`Iniciando download do PDF do boleto...`);
    const res = await fetch(url, { headers: getHeaders() });
    
    if (res.status !== 200) {
        console.error(`❌ Erro ao baixar PDF: HTTP ${res.status}`);
        return false;
    }

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const outputPath = path.join(__dirname, filename);
    fs.writeFileSync(outputPath, buffer);
    console.log(`✓ PDF do boleto baixado e salvo em: ${outputPath}`);
    return true;
}

async function main() {
    console.log('\n╔══════════════════════════════════════════════════════════════════════╗');
    console.log('║           ASAAS - BUSCA E ATUALIZAÇÃO INTERATIVA DE BOLETOS           ║');
    console.log('╚══════════════════════════════════════════════════════════════════════╝');

    if (!process.env.COOKIE_STRING) {
        console.error('\n[ERRO] COOKIE_STRING não configurado no .env.');
        console.error('Por favor, rode "node capture.js" primeiro para se autenticar.');
        process.exit(1);
    }

    while (true) {
        console.log('\n------------------------------------------------------------------------');
        console.log('O que você deseja fazer?');
        console.log('  [1] Editar vencimento de cobrança existente');
        console.log('  [2] Adicionar nova cobrança');
        console.log('  [sync] Recarregar/Sincronizar todos os clientes do Asaas');
        console.log('  [sair] Sair do sistema');
        console.log('');

        const acaoPrincipal = await ask('Opção: ');

        if (acaoPrincipal.toLowerCase().trim() === 'sair') {
            console.log('\nSaindo do sistema. Até logo!');
            break;
        }

        if (acaoPrincipal.toLowerCase().trim() === 'sync' || acaoPrincipal.toLowerCase().trim() === 'atualizar') {
            console.log('\nAtualizando o cache local de clientes...');
            await buscarClientes('', true);
            console.log('✓ Cache de clientes atualizado com sucesso!');
            continue;
        }

        if (acaoPrincipal !== '1' && acaoPrincipal !== '2') {
            console.log('❌ Opção inválida.');
            continue;
        }

        // Pesquisa de cliente comum a ambos os fluxos
        const nomeBusca = await ask('\nDigite o nome do cliente para pesquisar (ou "voltar"): ');
        if (nomeBusca.toLowerCase().trim() === 'voltar') {
            continue;
        }

        console.log('\nBuscando clientes...');
        const clientesFiltrados = await buscarClientes(nomeBusca);

        if (clientesFiltrados.length === 0) {
            console.log('❌ Nenhum cliente encontrado com esse nome. Tente novamente.');
            continue;
        }

        let clienteSelecionado = null;

        if (clientesFiltrados.length === 1) {
            clienteSelecionado = clientesFiltrados[0];
            console.log(`✓ Cliente selecionado automaticamente: ${clienteSelecionado.nome} (ID: ${clienteSelecionado.id})`);
        } else {
            console.log('\nClientes encontrados:');
            clientesFiltrados.forEach((c, idx) => {
                console.log(`  [${idx + 1}] ${c.nome} (ID: ${c.id})`);
            });
            console.log('');
            const opcao = await ask(`Selecione o número do cliente (1 a ${clientesFiltrados.length}, ou "voltar"): `);
            if (opcao.toLowerCase().trim() === 'voltar') {
                continue;
            }
            const idx = parseInt(opcao, 10) - 1;

            if (isNaN(idx) || idx < 0 || idx >= clientesFiltrados.length) {
                console.log('❌ Opção inválida.');
                continue;
            }
            clienteSelecionado = clientesFiltrados[idx];
        }

        if (acaoPrincipal === '1') {
            // FLUXO DE EDITAR VENCIMENTO
            console.log(`\nBuscando cobranças em aberto para: ${clienteSelecionado.nome}...`);
            const cobrancas = await obterCobrancasPendentes(clienteSelecionado.id);

            if (cobrancas.length === 0) {
                console.log('⚠️ Nenhuma cobrança com status "Aguardando pagamento" encontrada para este cliente.');
                continue;
            }

            console.log(`\nCobranças pendentes encontradas (${cobrancas.length}):`);
            cobrancas.forEach((cob, idx) => {
                console.log(`  [${idx + 1}] ID: ${cob.id} | Valor: ${cob.valor} | Vencimento: ${cob.vencimento}`);
            });
            console.log('');

            const cobOpcao = await ask(`Selecione a cobrança para alterar (1 a ${cobrancas.length}, ou "voltar"): `);
            
            if (cobOpcao.toLowerCase().trim() === 'voltar') {
                continue;
            }

            const cobIdx = parseInt(cobOpcao, 10) - 1;
            if (isNaN(cobIdx) || cobIdx < 0 || cobIdx >= cobrancas.length) {
                console.log('❌ Opção inválida.');
                continue;
            }

            const cobrancaSelecionada = cobrancas[cobIdx];
            console.log(`\nCobrança selecionada: ID ${cobrancaSelecionada.id} (Vencimento atual: ${cobrancaSelecionada.vencimento})`);

            const novoVencimento = await ask('Digite a nova data de vencimento (dd/mm/yyyy): ');
            if (!/^\d{2}\/\d{2}\/\d{4}$/.test(novoVencimento)) {
                console.log('❌ Formato de data inválido. Use o formato dd/mm/yyyy.');
                continue;
            }

            console.log('\nEnviando alteração de vencimento...');
            const sucesso = await salvarVencimento(cobrancaSelecionada.id, novoVencimento);

            if (sucesso) {
                console.log(`\n✓ Vencimento da cobrança ${cobrancaSelecionada.id} atualizado com sucesso para ${novoVencimento}!`);
                
                console.log('Carregando links de visualização...');
                const links = await obterLinksBoleto(cobrancaSelecionada.id);

                if (links) {
                    console.log('\n╔══════════════════════════════════════════════════════════════════════╗');
                    console.log('║                     LINKS PARA VISUALIZAÇÃO                          ║');
                    console.log('╚══════════════════════════════════════════════════════════════════════╝');
                    if (links.boleto) {
                        console.log(`  👉 Visualizar Boleto (PDF):  ${links.boleto}`);
                    }
                    if (links.fatura) {
                        console.log(`  👉 Visualizar Fatura (Web):  ${links.fatura}`);
                    }
                    console.log('════════════════════════════════════════════════════════════════════════');

                    if (links.token) {
                        const pdfName = `boleto_${cobrancaSelecionada.id}.pdf`;
                        await baixarPDFBoleto(links.token, pdfName);
                    }
                } else {
                    console.log('⚠️ Não foi possível obter os links do boleto após a atualização.');
                }
            } else {
                console.log('❌ Ocorreu um erro ao salvar o novo vencimento.');
            }
        } else if (acaoPrincipal === '2') {
            // FLUXO DE ADICIONAR COBRANÇA
            console.log(`\n=== ADICIONAR COBRANÇA PARA: ${clienteSelecionado.nome} ===`);
            const valorInput = await ask('Valor da cobrança (ex: 15,00 ou 150.50): ');
            
            let valor = valorInput.trim().replace('R$', '').trim();
            if (valor.includes('.') && !valor.includes(',')) {
                valor = valor.replace('.', ',');
            } else if (!valor.includes(',') && !valor.includes('.')) {
                valor = valor + ',00';
            }

            const vencimento = await ask('Data de vencimento (dd/mm/yyyy): ');
            if (!/^\d{2}\/\d{2}\/\d{4}$/.test(vencimento)) {
                console.log('❌ Formato de data inválido. Use o formato dd/mm/yyyy.');
                continue;
            }

            const descricao = await ask('Descrição/Fatura: ');

            console.log('\nCriando cobrança...');
            const resultado = await criarCobrancaParaCliente(clienteSelecionado.id, valor, vencimento, descricao);
            if (resultado && resultado.success) {
                console.log(`\n✓ Cobrança criada com sucesso! ID: ${resultado.pid}`);
                console.log('\n╔══════════════════════════════════════════════════════════════════════╗');
                console.log('║                     LINKS PARA VISUALIZAÇÃO                          ║');
                console.log('╚══════════════════════════════════════════════════════════════════════╝');
                console.log(`  👉 Visualizar Boleto (PDF):  https://www.asaas.com/b/pdf/${resultado.externalTokens}`);
                console.log(`  👉 Visualizar Fatura (Web):  https://www.asaas.com/i/${resultado.externalTokens}`);
                console.log('════════════════════════════════════════════════════════════════════════');

                const pdfName = `boleto_${resultado.pid}.pdf`;
                await baixarPDFBoleto(resultado.externalTokens, pdfName);
            } else {
                console.log('❌ Falha ao criar a cobrança.');
            }
        }
    }
}

main().catch(err => {
    console.error('Erro no sistema:', err.message);
    process.exit(1);
});
