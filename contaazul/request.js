const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const BASE_URL = 'https://mais.contaazul.com';

async function main() {
    const statePath = path.resolve(__dirname, 'state.json');
    if (!fs.existsSync(statePath)) {
        console.error('ERRO: state.json não encontrado. Execute "node contaazul/capture.js" primeiro.');
        process.exit(1);
    }

    console.log('=== TESTE DE AUTENTICAÇÃO - CONTA AZUL ===\n');

    // 1. Exemplo de requisição HTTP direta com cookies
    console.log('--- 1. Fazendo requisição HTTP direta com cookies ---');
    const cookieString = process.env.COOKIE_STRING;
    
    if (cookieString) {
        const headers = {
            'Cookie': cookieString,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        };

        // Adicionar headers de autenticação adicionais se capturados
        for (const [key, value] of Object.entries(process.env)) {
            if (key.startsWith('HEADER_')) {
                const headerName = key.substring(7).replace(/_/g, '-');
                headers[headerName] = value;
                console.log(`Incluindo Header adicional: ${headerName}`);
            }
        }

        try {
            const res = await fetch(`${BASE_URL}/`, { headers });
            console.log(`Status HTTP: ${res.status}`);
            console.log(`URL final redirecionada: ${res.url}`);
        } catch (err) {
            console.error('Erro na requisição HTTP:', err.message);
        }
    } else {
        console.log('COOKIE_STRING não encontrada no .env.');
    }

    // 2. Exemplo usando Playwright para restaurar a sessão
    console.log('\n--- 2. Testando Playwright restaurando estado ---');
    const browser = await chromium.launch({ headless: true });
    
    try {
        const context = await browser.newContext({ storageState: statePath });
        const page = await context.newPage();
        
        console.log('Navegando para o painel principal do Conta Azul...');
        await page.goto(BASE_URL);
        await page.waitForTimeout(4000); // Aguardar renderização

        const urlFinal = page.url();
        const titulo = await page.title();
        console.log(`URL final: ${urlFinal}`);
        console.log(`Título da página: ${titulo}`);

        // Tirar screenshot do estado da página
        const screenshotPath = path.resolve(__dirname, 'test_contaazul_session.png');
        await page.screenshot({ path: screenshotPath });
        console.log(`✓ Screenshot da sessão salvo em: ${screenshotPath}`);
    } catch (err) {
        console.error('Erro no Playwright:', err.message);
    } finally {
        await browser.close();
    }
}

main().catch(console.error);
