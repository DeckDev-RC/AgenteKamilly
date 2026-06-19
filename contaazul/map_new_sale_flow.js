const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

async function main() {
    const statePath = path.resolve(__dirname, 'state.json');
    if (!fs.existsSync(statePath)) {
        console.error('state.json not found in ' + statePath);
        process.exit(1);
    }

    console.log('Launching browser...');
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({ storageState: statePath });
    const page = await context.newPage();

    const networkLogs = [];
    context.on('request', request => {
        const url = request.url();
        const method = request.method();
        if (url.includes('services.contaazul.com') || url.includes('contaazul-bff') || url.includes('faturas')) {
            let headers = {};
            try {
                headers = request.headers();
            } catch (e) {}
            
            networkLogs.push({
                time: new Date().toISOString(),
                type: 'request',
                method,
                url,
                headers,
                postData: request.postData()
            });
        }
    });

    context.on('response', async response => {
        const request = response.request();
        const url = request.url();
        if (url.includes('services.contaazul.com') || url.includes('contaazul-bff') || url.includes('faturas')) {
            let body = null;
            try {
                const contentType = response.headers()['content-type'] || '';
                if (contentType.includes('application/json')) {
                    body = await response.json();
                } else if (contentType.includes('text/')) {
                    body = await response.text();
                }
            } catch (e) {}
            
            networkLogs.push({
                time: new Date().toISOString(),
                type: 'response',
                status: response.status(),
                url,
                body
            });
        }
    });

    console.log('Navigating to clientes...');
    await page.goto('https://mais.contaazul.com/#/clientes');
    await page.waitForTimeout(5000);

    console.log('Looking for MAIS NEGOCIOS...');
    const customerRow = page.locator('tr, div.customer-row, div.grid-row, .customer-row', { hasText: '3047702' }).first();
    const caProButton = customerRow.locator('a, button, [role="button"]', { hasText: 'CA Pro' }).first();
    
    console.log('Clicking CA Pro...');
    const [proPage] = await Promise.all([
        context.waitForEvent('page'),
        caProButton.click()
    ]);

    console.log('New tab opened. Waiting for CA Pro to load...');
    await proPage.waitForLoadState('networkidle');
    await proPage.waitForTimeout(5000);

    console.log(`Current URL in new tab: ${proPage.url()}`);

    // Periodic save of network logs
    const interval = setInterval(() => {
        fs.writeFileSync(path.resolve(__dirname, 'sales_network_logs.json'), JSON.stringify(networkLogs, null, 2));
    }, 2000);

    console.log('\n========================================================================');
    console.log('INSTRUÇÕES DE MAPEAMENTO:');
    console.log('1. No navegador aberto, acesse o menu de Serviços / Vendas.');
    console.log('2. Clique em "Nova venda de serviço" ou equivalente.');
    console.log('3. Preencha os campos solicitados pelo fluxo:');
    console.log('   - Cliente: AZUOS ASSESSORIA CONTÁBIL LTDA');
    console.log('   - Categoria Financeira: Honorário contábil mensal');
    console.log('   - Selecione ou crie um novo item: Honorário Contábil');
    console.log('   - Detalhes do item: Honorário mensal');
    console.log('   - Valor unitário: 10,00');
    console.log('   - Vencimento: 30/06/2026');
    console.log('4. Clique em "Salvar e ir para cobrança".');
    console.log('5. Na tela de "Gerar cobrança", ative Whatsapp + SMS + E-mail.');
    console.log('6. Ajuste/confirme os dados de contato do cliente:');
    console.log('   - Telefone celular com DDD: 62991514384');
    console.log('   - E-mail do cliente: kamilly.agregarnegocios@gmail.com');
    console.log('7. Clique em "Emitir cobrança".');
    console.log('8. Na tela de "Boleto emitido com sucesso", confirme o e-mail de contato:');
    console.log('   - E-mail para destinatário entrar em contato: sccontabilidadefinanceiro@gmail.com');
    console.log('9. Clique em "Enviar cobrança".');
    console.log('10. Clique em "Download do boleto" ou similar para baixar o PDF.');
    console.log('========================================================================\n');
    console.log('Pressione Ctrl+C neste terminal assim que terminar todo o fluxo.');

    // Wait forever
    await new Promise(() => {});
}

main().catch(console.error);
