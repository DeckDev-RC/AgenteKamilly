const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'create_page_dynamic.html');
if (fs.existsSync(filePath)) {
    const html = fs.readFileSync(filePath, 'utf-8');
    
    console.log('=== ANY FORM ===');
    const formMatches = html.match(/<form[^>]*>[\s\S]*?<\/form>/gi) || [];
    console.log(`Found ${formMatches.length} forms.`);
    formMatches.forEach((f, i) => console.log(`Form ${i+1}:`, f.substring(0, 300)));

    console.log('\n=== ANY ACTION/METHOD ===');
    const actions = html.match(/(?:action|method|href|src)\s*=\s*["']([^"']+)["']/gi) || [];
    console.log('Sample links/actions:');
    [...new Set(actions)].slice(0, 30).forEach(a => console.log(a));
} else {
    console.log('File does not exist');
}
