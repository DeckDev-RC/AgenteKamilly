const { chromium } = require('playwright');
const fs = require('fs');
const readline = require('readline');
const path = require('path');

function askQuestion(query) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    return new Promise(resolve => rl.question(query, ans => {
        rl.close();
        resolve(ans);
    }));
}

async function main() {
    console.log('=== CAPTURADOR DE SESSÃO COM PLAYWRIGHT ===\n');

    let targetUrl = process.argv[2];
    if (!targetUrl) {
        targetUrl = await askQuestion('Digite a URL do site para fazer login (ex: https://github.com): ');
    }

    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
        targetUrl = 'https://' + targetUrl;
    }

    console.log(`\nIniciando o navegador chromium headed...`);
    
    // Inicia o navegador de forma visível
    const browser = await chromium.launch({ 
        headless: false,
        args: ['--start-maximized']
    });
    
    const context = await browser.newContext({
        viewport: null // Usar tamanho padrão da tela maximizada
    });

    const page = await context.newPage();

    // Capturar headers interessantes que passem nas requisições (como Authorization tokens)
    const authHeaders = {};
    page.on('request', request => {
        const headers = request.headers();
        for (const [key, value] of Object.entries(headers)) {
            const keyLower = key.toLowerCase();
            if (
                keyLower === 'authorization' || 
                keyLower === 'x-auth-token' ||
                keyLower.includes('jwt') ||
                (keyLower.includes('token') && (value.startsWith('Bearer ') || value.length > 30))
            ) {
                authHeaders[key] = value;
            }
        }
    });

    console.log(`Navegando para: ${targetUrl}`);
    await page.goto(targetUrl);

    console.log('\n==================================================================');
    console.log(' NAVEGADOR ABERTO! ');
    console.log(' 1. Por favor, faça o login manualmente na janela do navegador.');
    console.log(' 2. Execute todas as etapas necessárias (MFA, captcha, etc.).');
    console.log(' 3. Quando estiver logado e na página principal, volte aqui.');
    console.log(' 4. Pressione ENTER neste console para capturar a sessão.');
    console.log('==================================================================\n');

    await askQuestion('Pressione ENTER quando o login estiver concluído...');

    console.log('\nCapturando dados da sessão...');

    // 1. Capturar cookies
    const cookies = await context.cookies();
    const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    // 2. Capturar localStorage e sessionStorage
    const storage = await page.evaluate(() => {
        return {
            localStorage: { ...localStorage },
            sessionStorage: { ...sessionStorage }
        };
    });

    // 3. Salvar estado estruturado completo do Playwright (cookies + local storage)
    const statePath = path.join(__dirname, 'state.json');
    await context.storageState({ path: statePath });
    console.log(`✓ Estado completo salvo em: state.json`);

    // 4. Montar o arquivo .env
    let envContent = `# Configurações da sessão capturada em ${new Date().toISOString()}\n`;
    envContent += `TARGET_URL="${targetUrl}"\n\n`;
    
    // Cookie string simplificada
    envContent += `# Cookies formatados para Headers HTTP\n`;
    envContent += `COOKIE_STRING="${cookieString.replace(/"/g, '\\"')}"\n\n`;

    // Headers de Autenticação capturados (Authorization, etc.)
    if (Object.keys(authHeaders).length > 0) {
        envContent += `# Headers de Autenticação Capturados\n`;
        for (const [key, value] of Object.entries(authHeaders)) {
            const cleanKey = key.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
            envContent += `HEADER_${cleanKey}="${value.replace(/"/g, '\\"')}"\n`;
        }
        envContent += `\n`;
    }

    // Local Storage
    if (Object.keys(storage.localStorage).length > 0) {
        envContent += `# Local Storage\n`;
        for (const [key, value] of Object.entries(storage.localStorage)) {
            const cleanKey = key.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
            const cleanVal = typeof value === 'string' ? value.replace(/"/g, '\\"') : JSON.stringify(value);
            envContent += `LOCAL_STORAGE_${cleanKey}="${cleanVal}"\n`;
        }
        envContent += `\n`;
    }

    // Session Storage
    if (Object.keys(storage.sessionStorage).length > 0) {
        envContent += `# Session Storage\n`;
        for (const [key, value] of Object.entries(storage.sessionStorage)) {
            const cleanKey = key.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
            const cleanVal = typeof value === 'string' ? value.replace(/"/g, '\\"') : JSON.stringify(value);
            envContent += `SESSION_STORAGE_${cleanKey}="${cleanVal}"\n`;
        }
        envContent += `\n`;
    }

    const envPath = path.join(__dirname, '.env');
    fs.writeFileSync(envPath, envContent, 'utf-8');
    console.log(`✓ Arquivo .env criado/atualizado com sucesso em: ${envPath}`);

    console.log('\nFechando o navegador...');
    await browser.close();
    console.log('Sessão finalizada com sucesso!');
}

main().catch(err => {
    console.error('Erro durante a execução:', err);
    process.exit(1);
});
