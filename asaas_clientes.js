/**
 * ASAAS - Automação de Clientes
 * 
 * Script para gerenciar clientes do Asaas via HTTP requests autenticados.
 * Utiliza cookies de sessão persistidos no .env (capturados via capture.js).
 * 
 * Uso:
 *   node asaas_clientes.js listar                     - Lista todos os clientes
 *   node asaas_clientes.js consultar <id>              - Consulta detalhes de um cliente
 *   node asaas_clientes.js criar                       - Cria um novo cliente (interativo)
 *   node asaas_clientes.js editar <id> <campo> <valor> - Edita um campo de um cliente
 *   node asaas_clientes.js exportar                    - Exporta clientes para JSON
 *   node asaas_clientes.js deletar <id>                - Deleta um cliente
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
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
// LISTAR CLIENTES
// ============================================
async function listarClientes(offset = 0, max = 50) {
    const url = `${BASE_URL}/customerAccount/loadTableContent?offset=${offset}&max=${max}`;
    const res = await fetch(url, { headers: getHeaders() });

    if (res.status !== 200) {
        console.error(`Erro ao listar clientes: HTTP ${res.status}`);
        return [];
    }

    const json = await res.json();
    const content = json.content || '';

    const rowRegex = /data-id="(\d+)"[\s\S]*?<atlas-text bold>(.*?)<\/atlas-text>[\s\S]*?<atlas-icon name="envelope"[\s\S]*?<atlas-text>(.*?)<\/atlas-text>[\s\S]*?<atlas-icon name="phone"[\s\S]*?<atlas-text>\s*(.*?)\s*<\/atlas-text>/g;

    const clientes = [];
    let match;
    while ((match = rowRegex.exec(content)) !== null) {
        clientes.push({
            id: match[1],
            nome: match[2].replace(/\\\//g, '/').trim(),
            email: match[3].replace(/&#64;/g, '@').replace(/\\\//g, '/').trim(),
            telefone: match[4].replace(/\\\//g, '/').trim(),
        });
    }

    return clientes;
}

// ============================================
// CONSULTAR CLIENTE POR ID
// ============================================
async function consultarCliente(id) {
    const url = `${BASE_URL}/customerAccount/show/${id}?edit=true`;
    const res = await fetch(url, { headers: getHeaders() });

    if (res.status !== 200) {
        console.error(`Erro ao consultar cliente ${id}: HTTP ${res.status}`);
        return null;
    }

    const html = await res.text();

    // Extrair valores dos campos do formulário
    const cliente = { id };
    const fieldsMap = {
        'name': 'Nome',
        'cpfCnpj': 'CPF/CNPJ',
        'email': 'Email',
        'company': 'Empresa',
        'mobilePhone': 'Celular',
        'phone': 'Telefone',
        'postalCode': 'CEP',
        'address': 'Endereço',
        'addressNumber': 'Número',
        'complement': 'Complemento',
        'province': 'Bairro',
        'city': 'Cidade',
        'uf': 'Estado',
        'municipalInscription': 'Inscrição Municipal',
        'inscricaoEstadual': 'Inscrição Estadual',
        'additionalEmails': 'Emails Adicionais',
        'observations': 'Observações',
    };

    for (const [field, label] of Object.entries(fieldsMap)) {
        // Tentar extrair value de input
        const inputRegex = new RegExp(`name=["']${field}["'][^>]*value=["']([^"']*)["']`, 'i');
        const inputMatch = html.match(inputRegex);
        if (inputMatch) {
            cliente[label] = decodeHTMLEntities(inputMatch[1]);
            continue;
        }
        // Tentar no formato inverso
        const inputRegex2 = new RegExp(`value=["']([^"']*)["'][^>]*name=["']${field}["']`, 'i');
        const inputMatch2 = html.match(inputRegex2);
        if (inputMatch2) {
            cliente[label] = decodeHTMLEntities(inputMatch2[1]);
            continue;
        }
        cliente[label] = '';
    }

    return cliente;
}

function decodeHTMLEntities(text) {
    return text
        .replace(/&#64;/g, '@')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}

// ============================================
// CRIAR CLIENTE
// ============================================
async function criarCliente(dados) {
    const formData = new URLSearchParams();
    for (const [key, value] of Object.entries(dados)) {
        formData.append(key, value);
    }

    const res = await fetch(`${BASE_URL}/customerAccount/save`, {
        method: 'POST',
        headers: {
            ...getHeaders(),
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
        redirect: 'manual',
    });

    console.log(`Status: ${res.status}`);
    const text = await res.text();

    if (res.status === 200 || res.status === 302) {
        console.log('✓ Cliente criado/salvo com sucesso!');
        return true;
    } else {
        console.error('Erro ao salvar cliente:', text.substring(0, 500));
        return false;
    }
}

// ============================================
// EDITAR CLIENTE
// ============================================
async function editarCliente(id, campo, valor) {
    // Primeiro buscar dados atuais do cliente
    const clienteAtual = await consultarCliente(id);
    if (!clienteAtual) {
        console.error('Cliente não encontrado.');
        return false;
    }

    // Mapear labels para campos internos
    const reverseMap = {
        'nome': 'name',
        'cpf/cnpj': 'cpfCnpj',
        'cpfcnpj': 'cpfCnpj',
        'email': 'email',
        'empresa': 'company',
        'celular': 'mobilePhone',
        'telefone': 'phone',
        'cep': 'postalCode',
        'endereco': 'address',
        'endereço': 'address',
        'numero': 'addressNumber',
        'número': 'addressNumber',
        'complemento': 'complement',
        'bairro': 'province',
        'cidade': 'city',
        'estado': 'uf',
        'observacoes': 'observations',
        'observações': 'observations',
    };

    const campoInterno = reverseMap[campo.toLowerCase()] || campo;

    const formData = new URLSearchParams();
    formData.append('id', id);
    formData.append(campoInterno, valor);

    const res = await fetch(`${BASE_URL}/customerAccount/save`, {
        method: 'POST',
        headers: {
            ...getHeaders(),
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
        redirect: 'manual',
    });

    if (res.status === 200 || res.status === 302) {
        console.log(`✓ Cliente ${id} atualizado: ${campo} = "${valor}"`);
        return true;
    } else {
        const text = await res.text();
        console.error('Erro ao editar:', text.substring(0, 500));
        return false;
    }
}

// ============================================
// DELETAR CLIENTE
// ============================================
async function deletarCliente(id) {
    const formData = new URLSearchParams();
    formData.append('id', id);

    const res = await fetch(`${BASE_URL}/customerAccount/deleteAjax`, {
        method: 'POST',
        headers: {
            ...getHeaders(),
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
    });

    const json = await res.json().catch(() => null);
    if (json && json.success) {
        console.log(`✓ Cliente ${id} deletado com sucesso.`);
    } else {
        console.log(`Resposta: ${JSON.stringify(json)}`);
    }
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
// EXPORTAR CLIENTES PARA JSON
// ============================================
async function exportarClientes() {
    console.log('Buscando todos os clientes...');
    let todos = [];
    let offset = 0;
    const max = 50;

    while (true) {
        const lote = await listarClientes(offset, max);
        if (lote.length === 0) break;
        todos = todos.concat(lote);
        offset += max;
        if (lote.length < max) break;
    }

    console.log(`Total: ${todos.length} clientes encontrados.`);
    console.log('Consultando detalhes de forma concorrente (máximo 15 requisições paralelas)...');

    let concluido = 0;
    const detalhados = await mapConcurrent(todos, 15, async (c) => {
        const detalhe = await consultarCliente(c.id);
        concluido++;
        process.stdout.write(`\r  Progresso: ${concluido}/${todos.length} (${Math.round((concluido / todos.length) * 100)}%)`);
        return detalhe || c;
    });
    console.log('\n✓ Detalhes carregados.');

    const outputPath = path.join(__dirname, 'clientes_export.json');
    fs.writeFileSync(outputPath, JSON.stringify(detalhados, null, 2), 'utf-8');
    console.log(`\n✓ Exportado para: ${outputPath}`);
    return detalhados;
}

// ============================================
// CRIAR CLIENTE INTERATIVO
// ============================================
async function criarClienteInterativo() {
    console.log('\n=== CRIAR NOVO CLIENTE ===\n');
    console.log('Campos disponíveis:');
    console.log('  name, cpfCnpj, email, company, mobilePhone, phone,');
    console.log('  postalCode, address, addressNumber, complement,');
    console.log('  province, city, uf, observations\n');

    const dados = {};
    dados.name = await ask('Nome *: ');
    dados.cpfCnpj = await ask('CPF/CNPJ *: ');
    dados.email = await ask('Email: ');
    dados.mobilePhone = await ask('Celular: ');
    dados.phone = await ask('Telefone: ');
    dados.postalCode = await ask('CEP: ');
    dados.address = await ask('Endereço: ');
    dados.addressNumber = await ask('Número: ');
    dados.complement = await ask('Complemento: ');
    dados.province = await ask('Bairro: ');
    dados.city = await ask('Cidade: ');
    dados.uf = await ask('Estado (UF): ');
    dados.observations = await ask('Observações: ');

    // Remover campos vazios
    for (const key of Object.keys(dados)) {
        if (!dados[key]) delete dados[key];
    }

    console.log('\nDados a enviar:', JSON.stringify(dados, null, 2));
    const confirm = await ask('\nConfirma criação? (s/n): ');
    if (confirm.toLowerCase() === 's') {
        await criarCliente(dados);
    } else {
        console.log('Cancelado.');
    }
}

// ============================================
// MAIN
// ============================================
async function main() {
    const [,, comando, ...args] = process.argv;

    if (!process.env.COOKIE_STRING) {
        console.error('ERRO: COOKIE_STRING não encontrada no .env.');
        console.error('Execute "node capture.js" primeiro para capturar a sessão.');
        process.exit(1);
    }

    switch (comando) {
        case 'listar': {
            const clientes = await listarClientes();
            console.log('\n╔══════════════════════════════════════════════════════════════════════╗');
            console.log('║                        MEUS CLIENTES - ASAAS                        ║');
            console.log('╚══════════════════════════════════════════════════════════════════════╝\n');
            clientes.forEach((c, i) => {
                console.log(`  ${i + 1}. ${c.nome}`);
                console.log(`     ID: ${c.id} | Email: ${c.email} | Tel: ${c.telefone}`);
                console.log('');
            });
            console.log(`Total: ${clientes.length} clientes.`);
            break;
        }

        case 'consultar': {
            const id = args[0];
            if (!id) {
                console.error('Uso: node asaas_clientes.js consultar <id>');
                process.exit(1);
            }
            const cliente = await consultarCliente(id);
            if (cliente) {
                console.log('\n╔══════════════════════════════════════════════════════════════════════╗');
                console.log('║                       DETALHES DO CLIENTE                           ║');
                console.log('╚══════════════════════════════════════════════════════════════════════╝\n');
                for (const [key, value] of Object.entries(cliente)) {
                    if (value) console.log(`  ${key}: ${value}`);
                }
            }
            break;
        }

        case 'criar': {
            await criarClienteInterativo();
            break;
        }

        case 'editar': {
            const [id, campo, ...valorParts] = args;
            const valor = valorParts.join(' ');
            if (!id || !campo || !valor) {
                console.error('Uso: node asaas_clientes.js editar <id> <campo> <valor>');
                console.error('Campos: nome, email, telefone, celular, cpf/cnpj, endereco, cep, cidade, estado, bairro, complemento, numero, observacoes');
                process.exit(1);
            }
            await editarCliente(id, campo, valor);
            break;
        }

        case 'exportar': {
            await exportarClientes();
            break;
        }

        case 'deletar': {
            const delId = args[0];
            if (!delId) {
                console.error('Uso: node asaas_clientes.js deletar <id>');
                process.exit(1);
            }
            const confirma = await ask(`Tem certeza que deseja deletar o cliente ${delId}? (s/n): `);
            if (confirma.toLowerCase() === 's') {
                await deletarCliente(delId);
            }
            break;
        }

        default: {
            console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║               ASAAS - AUTOMAÇÃO DE CLIENTES                        ║
╚══════════════════════════════════════════════════════════════════════╝

Comandos disponíveis:

  node asaas_clientes.js listar                       Lista todos os clientes
  node asaas_clientes.js consultar <id>               Consulta detalhes de um cliente
  node asaas_clientes.js criar                        Cria um novo cliente (interativo)
  node asaas_clientes.js editar <id> <campo> <valor>  Edita um campo de um cliente
  node asaas_clientes.js exportar                     Exporta todos os clientes para JSON
  node asaas_clientes.js deletar <id>                 Deleta um cliente

Campos editáveis:
  nome, email, telefone, celular, cpf/cnpj, empresa, cep, endereco,
  numero, complemento, bairro, cidade, estado, observacoes
`);
        }
    }
}

main().catch(err => {
    console.error('Erro:', err.message);
    process.exit(1);
});
