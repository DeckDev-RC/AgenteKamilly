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

    await page.goto('https://www.asaas.com/payment/create');
    await page.waitForTimeout(4000);

    // List all elements starting with "atlas-"
    const atlasElements = await page.evaluate(() => {
        const all = Array.from(document.querySelectorAll('*'));
        const atlas = all.filter(el => el.tagName.toLowerCase().startsWith('atlas-'));
        return atlas.map(el => {
            const attrs = {};
            for (let i = 0; i < el.attributes.length; i++) {
                const attr = el.attributes[i];
                attrs[attr.name] = attr.value;
            }
            return {
                tag: el.tagName.toLowerCase(),
                id: el.id || '',
                class: el.className || '',
                attributes: attrs,
                text: el.innerText || ''
            };
        });
    });

    console.log(`=== FOUND ${atlasElements.length} ATLAS ELEMENTS ===`);
    atlasElements.forEach((el, idx) => {
        // Log details of interesting input fields
        const str = JSON.stringify(el).toLowerCase();
        if (str.includes('value') || str.includes('due') || str.includes('description') || str.includes('billing') || str.includes('interest') || str.includes('fine') || str.includes('customer') || str.includes('juros') || str.includes('multa')) {
            console.log(`[${idx+1}]`, el.tag, 'Attrs:', el.attributes, 'Text:', el.text.trim().substring(0, 100));
        }
    });

    await browser.close();
}

main().catch(console.error);
