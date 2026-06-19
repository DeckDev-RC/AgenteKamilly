/**
 * ASAAS - Abrir Navegador Logado no Dashboard
 * 
 * Inicia o Chromium visível carregando a sessão ativa do arquivo state.json.
 * 
 * Uso:
 *   node cobrancas/abrir_dashboard.js
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

async function main() {
    const statePath = path.join(__dirname, '../state.json');
    if (!fs.existsSync(statePath)) {
        console.error('ERRO: arquivo state.json não encontrado.');
        console.error('Por favor, execute "node capture.js" primeiro para fazer login.');
        process.exit(1);
    }

    console.log('Iniciando o navegador Chromium com a sessão ativa...');
    const browser = await chromium.launch({
        headless: false,
        args: ['--start-maximized']
    });

    const context = await browser.newContext({
        storageState: statePath,
        viewport: null
    });

    const page = await context.newPage();
    await page.goto('https://www.asaas.com/dashboard/index', { waitUntil: 'domcontentloaded' });

    console.log('\n╔══════════════════════════════════════════════════════════════════════╗');
    console.log('║                NAVEGADOR DO ASAAS ABERTO E LOGADO                    ║');
    console.log('╠══════════════════════════════════════════════════════════════════════╣');
    console.log('║  * O navegador está utilizando sua sessão salva do state.json.       ║');
    console.log('║  * Pressione CTRL+C neste terminal para fechar o navegador.          ║');
    console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

    // Manter o processo vivo indefinidamente até que o usuário feche o navegador ou pare o processo
    page.on('close', () => {
        console.log('Navegador fechado pelo usuário. Finalizando processo...');
        process.exit(0);
    });

    // Aguardar entrada para fechar
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('Pressione ENTER para fechar o navegador e sair...\n', async () => {
        console.log('Fechando navegador...');
        await browser.close();
        rl.close();
        process.exit(0);
    });
}

main().catch(err => {
    console.error('Erro:', err);
    process.exit(1);
});
