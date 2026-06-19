require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function runFetchExample() {
    console.log('\n--- MÉTODO A: Requisição HTTP com Node.js fetch nativo ---');

    const targetUrl = process.env.TARGET_URL;
    const cookieString = process.env.COOKIE_STRING;

    if (!targetUrl) {
        console.error('ERRO: TARGET_URL não configurada no .env. Execute o capture.js primeiro.');
        return;
    }

    // Configurando os headers
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    };

    // Adiciona os cookies se houverem
    if (cookieString) {
        headers['Cookie'] = cookieString;
        console.log('✓ Cookies carregados para a requisição.');
    }

    // Adiciona headers de autenticação adicionais capturados (ex: Authorization Bearer)
    for (const [key, value] of Object.entries(process.env)) {
        if (key.startsWith('HEADER_')) {
            const headerName = key.replace('HEADER_', '').toLowerCase().replace(/_/g, '-');
            headers[headerName] = value;
            console.log(`✓ Header carregado: ${headerName} = ${value.substring(0, 15)}...`);
        }
    }

    try {
        console.log(`Fazendo requisição GET para: ${targetUrl}`);
        const response = await fetch(targetUrl, { headers });
        console.log(`Status da Resposta: ${response.status} ${response.statusText}`);
        
        const text = await response.text();
        console.log(`Tamanho do HTML retornado: ${text.length} caracteres.`);
        console.log(`Prévia do HTML retornado:\n${text.substring(0, 300)}...`);
    } catch (err) {
        console.error('Erro ao fazer a requisição HTTP:', err.message);
    }
}

async function runPlaywrightExample() {
    console.log('\n--- MÉTODO B: Automação Playwright restaurando estado ---');
    
    const statePath = path.join(__dirname, 'state.json');
    if (!fs.existsSync(statePath)) {
        console.log('Aviso: state.json não encontrado. Pulei o exemplo do Playwright.');
        return;
    }

    console.log(`Carregando estado da sessão de: ${statePath}`);
    
    // Inicia navegador (pode ser headless: true para rodar em background)
    const browser = await chromium.launch({ headless: true });
    
    // Cria contexto restaurando cookies e localStorage salvos
    const context = await browser.newContext({
        storageState: statePath
    });

    const page = await context.newPage();
    const targetUrl = process.env.TARGET_URL;

    try {
        console.log(`Navegando para ${targetUrl} com a sessão já ativa...`);
        await page.goto(targetUrl);
        
        // Aguarda um pouco para carregar elementos
        await page.waitForTimeout(2000);

        console.log(`URL final após navegação: ${page.url()}`);
        const title = await page.title();
        console.log(`Título da página: ${title}`);
        
        // Tirar screenshot para provar que está logado
        const screenshotPath = path.join(__dirname, 'screenshot_result.png');
        await page.screenshot({ path: screenshotPath });
        console.log(`✓ Screenshot da página logada salvo em: ${screenshotPath}`);
        
    } catch (err) {
        console.error('Erro na automação do Playwright:', err.message);
    } finally {
        await browser.close();
    }
}

async function main() {
    await runFetchExample();
    await runPlaywrightExample();
}

main();
