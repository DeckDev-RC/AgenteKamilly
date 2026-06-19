const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

async function main() {
    const statePath = path.join(__dirname, '../state.json');
    if (!fs.existsSync(statePath)) {
        console.error('ERRO: state.json não encontrado.');
        process.exit(1);
    }

    console.log('Iniciando Chromium headless...');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ storageState: statePath });
    const page = await context.newPage();

    console.log('Navegando para a página de criação de cobrança...');
    await page.goto('https://www.asaas.com/payment/create');
    await page.waitForTimeout(3000); // Aguardar o carregamento dinâmico

    console.log('URL atual:', page.url());

    // Obter todo o HTML e inspecionar os elementos de formulário
    const html = await page.content();
    fs.writeFileSync(path.join(__dirname, 'create_page_dynamic.html'), html);
    console.log('HTML dinâmico salvo em create_page_dynamic.html');

    // Buscar por seletores de input/select/textarea
    const inputsInfo = await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll('input, select, textarea, form'));
        return els.map(el => {
            return {
                tag: el.tagName.toLowerCase(),
                id: el.id || '',
                name: el.name || '',
                type: el.type || '',
                value: el.value || '',
                class: el.className || '',
                action: el.action || ''
            };
        });
    });

    console.log('\n=== ELEMENTOS ENCONTRADOS NO DOM DINÂMICO ===');
    inputsInfo.forEach(inp => {
        // Filtrar apenas campos interessantes
        const str = JSON.stringify(inp).toLowerCase();
        if (str.includes('value') || str.includes('duedate') || str.includes('description') || str.includes('billingtype') || str.includes('interest') || str.includes('fine') || str.includes('customer') || inp.tag === 'form') {
            console.log(inp);
        }
    });

    await browser.close();
}

main().catch(console.error);
