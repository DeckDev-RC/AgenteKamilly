const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

async function main() {
    const cookie = process.env.COOKIE_STRING;
    const headers = {
        'Cookie': cookie,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    };

    const res = await fetch('https://www.asaas.com/payment/create', { headers });
    const html = await res.text();

    console.log('=== FORM ELEMENT IN CREATE ===');
    const formIdx = html.indexOf('action="/payment/');
    if (formIdx > -1) {
        console.log(html.substring(formIdx - 50, formIdx + 300));
    } else {
        // Try finding any forms
        const formMatches = html.match(/<form[^>]*>/gi) || [];
        formMatches.forEach(f => console.log(f));
    }

    console.log('\n=== INPUT/SELECT FIELDS ===');
    const inputs = html.match(/<(?:input|select|textarea)[^>]*(?:name|id)=["'][^"']+["'][^>]*>/gi) || [];
    const uniqueInputs = [...new Set(inputs)];
    uniqueInputs.forEach(inp => {
        if (inp.includes('value') || inp.includes('dueDate') || inp.includes('description') || inp.includes('billingType') || inp.includes('interest') || inp.includes('fine') || inp.includes('customer')) {
            console.log(inp.trim());
        }
    });

    console.log('\n=== AJAX SAVE URLS IN SCRIPTS ===');
    const scripts = html.match(/[^"']*(?:\/payment\/save|\/payment\/saveAjax|\/payment\/createAjax)[^"']*/gi) || [];
    [...new Set(scripts)].forEach(s => console.log(s.trim()));
}

main();
