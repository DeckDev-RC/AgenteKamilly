const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

async function main() {
    const statePath = path.join(__dirname, 'state.json');
    if (!fs.existsSync(statePath)) {
        console.error('state.json not found');
        process.exit(1);
    }

    console.log('Iniciando Chromium...');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ storageState: statePath });
    const page = await context.newPage();

    // Monitorar abertura de novas abas
    context.on('page', async newPage => {
        console.log(`[Nova Aba aberta]: ${newPage.url()}`);
        await newPage.waitForLoadState();
        console.log(`[Nova Aba pronta]: ${newPage.url()}`);
    });

    console.log('Navegando para mais.contaazul.com/#/clientes...');
    await page.goto('https://mais.contaazul.com/#/clientes');
    await page.waitForTimeout(5000);

    // Pegar as linhas dos clientes que possuem botão CA Pro
    const rows = page.locator('tr').filter({ hasText: 'CA Pro' });
    const count = await rows.count();
    console.log(`Total de clientes com CA Pro na página: ${count}`);

    if (count < 2) {
        console.log('Não há clientes suficientes com CA Pro para testar a troca de sessão.');
        await browser.close();
        return;
    }

    // Pegar o nome do primeiro cliente
    const firstClientName = await rows.nth(0).locator('td').first().innerText();
    console.log(`\n--- Passo 1: Clicando no CA Pro do primeiro cliente: "${firstClientName}" ---`);
    const firstBadge = rows.nth(0).locator('span.ds-badge').first();
    await firstBadge.click();

    console.log('Aguardando 8 segundos para a primeira sessão iniciar...');
    await page.waitForTimeout(8000);

    // Pegar o nome do segundo cliente
    const secondClientName = await rows.nth(1).locator('td').first().innerText();
    console.log(`\n--- Passo 2: Clicando no CA Pro do segundo cliente: "${secondClientName}" ---`);
    const secondBadge = rows.nth(1).locator('span.ds-badge').first();
    await secondBadge.click();

    console.log('Aguardando 3 segundos para o modal de confirmação aparecer...');
    await page.waitForTimeout(3000);

    // Salvar screenshot do modal
    const screenshotPath = path.join(__dirname, 'session_switch_modal.png');
    await page.screenshot({ path: screenshotPath });
    console.log(`Screenshot do modal salva em ${screenshotPath}`);

    // Inspecionar botões do modal
    const buttons = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('button, .ds-button, [role="button"]')).map(btn => ({
            text: btn.innerText,
            class: btn.className,
            tagName: btn.tagName
        }));
    });
    console.log('\n--- Botões visíveis na página durante o modal ---');
    console.log(buttons);

    // Tentar clicar em Confirmar usando diferentes seletores
    console.log('Tentando localizar o botão "Confirmar"...');
    const confirmBtn = page.locator('button:has-text("Confirmar"), .ds-button:has-text("Confirmar"), button:has-text("confirmar")').first();
    if (await confirmBtn.isVisible()) {
        console.log('Botão "Confirmar" visível! Clicando...');
        await confirmBtn.click();
        console.log('Aguardando redirecionamento após confirmação...');
        await page.waitForTimeout(8000);
    } else {
        console.log('Botão "Confirmar" não está visível usando seletores padrão.');
    }

    await browser.close();
}

main().catch(console.error);
