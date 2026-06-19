const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

async function main() {
    const statePath = path.join(__dirname, '../state.json');
    if (!fs.existsSync(statePath)) {
        console.error('ERRO: state.json não encontrado.');
        process.exit(1);
    }

    console.log('Iniciando Chromium...');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ storageState: statePath });
    const page = await context.newPage();

    console.log('Navegando para a página de criação de cobrança...');
    await page.goto('https://www.asaas.com/payment/create');
    await page.waitForTimeout(4000); // Aguardar o carregamento dinâmico

    // Tirar screenshot
    const screenshotPath = path.join(__dirname, 'create_step1.png');
    await page.screenshot({ path: screenshotPath });
    console.log(`✓ Screenshot salvo em: ${screenshotPath}`);

    // Obter todos os textos visíveis no body
    const text = await page.evaluate(() => document.body.innerText);
    console.log('\n=== TEXTO VISÍVEL NA TELA ===');
    console.log(text);

    // Listar todos os botões e links visíveis
    const elements = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button, a, input, select'));
        return buttons.map(el => ({
            tag: el.tagName.toLowerCase(),
            text: el.innerText || el.value || '',
            id: el.id || '',
            class: el.className || '',
            placeholder: el.placeholder || ''
        }));
    });
    console.log('\n=== BOTÕES E CAMPOS VISÍVEIS ===');
    elements.forEach(el => {
        if (el.text.trim() || el.placeholder.trim()) {
            console.log(el);
        }
    });

    await browser.close();
}

main().catch(console.error);
