const fs = require('fs');
const path = require('path');

const authToken = '5000ee02-eaf3-4c23-941c-4cf9d0271c39';

async function testFilter(body) {
    const url = 'https://services.contaazul.com/finance-pro-reader/v1/financial-statement-view?page=1&page_size=10';
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'x-authorization': authToken,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });
    
    if (res.status === 200) {
        const json = await res.json();
        return json.items || [];
    }
    return null;
}

async function main() {
    const cases = [
        { name: 'initial_date / final_date', body: { initial_date: '2023-11-01', final_date: '2023-11-15' } },
        { name: 'initialDate / finalDate', body: { initialDate: '2023-11-01', finalDate: '2023-11-15' } },
        { name: 'dateStart / dateEnd', body: { dateStart: '2023-11-01', dateEnd: '2023-11-15' } },
        { name: 'from / to', body: { from: '2023-11-01', to: '2023-11-15' } },
        { name: 'period_start / period_end', body: { period_start: '2023-11-01', period_end: '2023-11-15' } },
        { name: 'periodStart / periodEnd', body: { periodStart: '2023-11-01', periodEnd: '2023-11-15' } },
        { name: 'dates: [start, end]', body: { dates: ['2023-11-01', '2023-11-15'] } }
    ];

    for (const c of cases) {
        const items = await testFilter(c.body);
        console.log(`\n--- Teste: ${c.name} ---`);
        if (items) {
            console.log(`Total retornado: ${items.length}`);
            const outsideRange = items.filter(item => item.date > '2023-11-15');
            console.log(`Lançamentos fora do intervalo (após 15/11): ${outsideRange.length}`);
            if (outsideRange.length === 0 && items.length > 0) {
                console.log('🎉 SUCESSO! Esse formato filtrou corretamente!');
                console.log('Itens filtrados:');
                items.forEach(item => console.log(`  ${item.date} - ${item.description}`));
            }
        } else {
            console.log('Falha na requisição');
        }
    }
}

main().catch(console.error);
