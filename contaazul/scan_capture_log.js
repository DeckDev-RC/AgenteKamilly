const fs = require('fs');
const path = require('path');

const logPath = 'C:\\Users\\User\\.gemini\\antigravity\\brain\\907e1d9c-19a6-4ae1-9801-f3773ba420d9\\.system_generated\\tasks\\task-1282.log';

if (!fs.existsSync(logPath)) {
    console.error('Log file not found');
    process.exit(1);
}

const lines = fs.readFileSync(logPath, 'utf8').split('\n');

console.log('--- Scanning log for financial statement requests ---');
lines.forEach((line, idx) => {
    if (line.includes('financial-statement-view') || line.includes('statement-view')) {
        console.log(`Line ${idx + 1}: ${line}`);
        // Se as próximas linhas tiverem o body da requisição, printa também
        for (let i = 1; i <= 3; i++) {
            if (lines[idx + i] && lines[idx + i].includes('Body:')) {
                console.log(`   Next Line ${idx + i + 1}: ${lines[idx + i]}`);
            }
        }
    }
});
