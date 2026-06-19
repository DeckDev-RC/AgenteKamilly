const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'create_page_dynamic.html');
if (fs.existsSync(filePath)) {
    const html = fs.readFileSync(filePath, 'utf-8');
    
    // Look for form tags
    console.log('=== FORMS ===');
    const formRegex = /<form[^>]*>/gi;
    let match;
    while ((match = formRegex.exec(html)) !== null) {
        console.log(match[0]);
    }

    // Look for form actions
    console.log('\n=== FORM ACTIONS OR APIS ===');
    const urls = html.match(/['"]\/payment\/[^'"]+['"]/g) || [];
    [...new Set(urls)].forEach(u => console.log(u));
} else {
    console.log('File does not exist');
}
