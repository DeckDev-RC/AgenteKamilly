const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

async function main() {
    const statePath = path.resolve(__dirname, 'state.json');
    if (!fs.existsSync(statePath)) {
        console.error('ERRO: state.json não encontrado.');
        process.exit(1);
    }

    console.log('Iniciando Chromium para inspecionar o clique do CA Pro...');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ storageState: statePath });
    const page = await context.newPage();

    const logs = [];
    page.on('request', request => {
        const url = request.url();
        const method = request.method();
        if (url.includes('contaazul.com') && !url.includes('hotjar') && !url.includes('segment')) {
            const data = {
                url,
                method,
                headers: request.headers(),
                postData: request.postData()
            };
            logs.push(data);
            fs.appendFileSync(path.join(__dirname, 'live_network_log.txt'), `${method} ${url}\n`);
            console.log(`[Request] ${method} ${url}`);
        }
    });

    console.log('Navegando para mais.contaazul.com...');
    await page.goto('https://mais.contaazul.com/');
    await page.waitForTimeout(5000); 

    // Procurar por botões "CA Pro"
    console.log('Procurando botões "CA Pro"...');
    // Procurar por botão CA Pro do cliente "DM DECORACOES LTDA" (ID do usuário no cache ou podemos pegar o primeiro)
    const button = page.locator('text=CA Pro').first();
    
    if (await button.isVisible()) {
        console.log('Clicando no botão CA Pro...');
        await button.click();
        
        console.log('Aguardando 10 segundos para o redirecionamento e carregamento...');
        await page.waitForTimeout(10000);

        console.log('URL final:', page.url());
        console.log('Título da página:', await page.title());

        // Salvar screenshot do Conta Azul Pro
        await page.screenshot({ path: path.join(__dirname, 'ca_pro_dashboard.png'), fullPage: true });
        console.log('✓ Salvo ca_pro_dashboard.png');

        // Salvar HTML do Conta Azul Pro
        const proHtml = await page.content();
        fs.writeFileSync(path.join(__dirname, 'ca_pro_dashboard.html'), proHtml);
        console.log('✓ Salvo ca_pro_dashboard.html');
    } else {
        console.log('Botão CA Pro não encontrado.');
    }

    // Salvar JSON com todas as requisições capturadas
    fs.writeFileSync(path.join(__dirname, 'ca_network_logs.json'), JSON.stringify(logs, null, 2));
    console.log('✓ Salvo ca_network_logs.json');

    await browser.close();
}

main().catch(console.error);
