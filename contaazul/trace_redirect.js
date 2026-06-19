const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

async function main() {
  const statePath = path.resolve(__dirname, 'state.json');
  if (!fs.existsSync(statePath)) {
    console.error('state.json not found');
    process.exit(1);
  }

  console.log('Iniciando Chromium para rastrear o redirecionamento...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: statePath });
  const page = await context.newPage();

  // Listen to ALL requests in the context (cross-page)
  context.on('page', newPage => {
    console.log(`[Nova Aba aberta]: ${newPage.url()}`);
    newPage.on('request', req => {
      const url = req.url();
      if (url.includes('contaazul.com')) {
        console.log(`[ABA 1 - REQ] ${req.method()} ${url}`);
      }
    });
    newPage.on('response', res => {
      const url = res.url();
      if (url.includes('contaazul.com')) {
        console.log(`[ABA 1 - RES] ${res.status()} for ${url}`);
        if (res.headers()['location']) {
          console.log(`              Location -> ${res.headers()['location']}`);
        }
      }
    });
  });

  page.on('request', req => {
    const url = req.url();
    if (url.includes('contaazul.com')) {
      console.log(`[ABA 0 - REQ] ${req.method()} ${url}`);
    }
  });

  page.on('response', res => {
    const url = res.url();
    if (url.includes('contaazul.com')) {
      const status = res.status();
      if (status >= 300 && status < 400) {
        console.log(`[ABA 0 - REDIRECT] Status ${status} for ${url} -> ${res.headers()['location']}`);
      }
    }
  });

  console.log('Navegando para mais.contaazul.com/#/clientes...');
  await page.goto('https://mais.contaazul.com/#/clientes');
  await page.waitForTimeout(5000);

  console.log('Clicando no botão CA Pro...');
  const row = page.locator('tr').filter({ hasText: 'MAIS NEGOCIOS ASSESSORIA CONTABIL LTDA' });
  const badge = row.locator('b:has-text("CA Pro")').first();
  await badge.click();

  await page.waitForTimeout(2000);

  const confirmBtn = page.locator('button:has-text("Confirmar")');
  if (await confirmBtn.isVisible()) {
    console.log('Confirmando troca de sessão...');
    await confirmBtn.click();
  }

  console.log('Aguardando 10 segundos para rastrear...');
  await page.waitForTimeout(10000);

  await browser.close();
}

main().catch(console.error);
