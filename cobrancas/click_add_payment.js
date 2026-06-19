const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

async function main() {
    const statePath = path.join(__dirname, '../state.json');
    if (!fs.existsSync(statePath)) {
        console.error('ERRO: state.json não encontrado.');
        process.exit(1);
    }

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ storageState: statePath });
    const page = await context.newPage();

    const customerId = '100322369';
    console.log(`Navegando para a página do cliente ${customerId}...`);
    await page.goto(`https://www.asaas.com/customerAccount/show/${customerId}`);
    await page.waitForTimeout(3000);

    console.log('Clicando no botão "+ Adicionar cobrança"...');
    await page.click('button.btn-add-payment');
    await page.waitForTimeout(2000);

    // Tirar screenshot
    await page.screenshot({ path: path.join(__dirname, 'add_payment_clicked.png'), fullPage: true });
    console.log('Saved add_payment_clicked.png');

    // Salvar o HTML do modal/página para inspecionar
    const html = await page.content();
    fs.writeFileSync(path.join(__dirname, 'add_payment_modal.html'), html);
    console.log('HTML salvo em add_payment_modal.html');

    // Listar todos os inputs e seus atributos que surgiram na tela
    const inputs = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('input, select, textarea, form')).map(el => ({
            tag: el.tagName.toLowerCase(),
            name: el.getAttribute('name') || '',
            id: el.getAttribute('id') || '',
            type: el.getAttribute('type') || '',
            value: el.value || '',
            class: el.className || ''
        }));
    });

    console.log('=== INPUTS ENCONTRADOS APÓS CLIQUE ===');
    console.log(JSON.stringify(inputs.filter(inp => inp.name || inp.id), null, 2));

    await browser.close();
}

main().catch(console.error);
