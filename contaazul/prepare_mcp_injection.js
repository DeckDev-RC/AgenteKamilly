const fs = require('fs');
const path = require('path');

const statePath = path.resolve(__dirname, 'state.json');
if (!fs.existsSync(statePath)) {
    console.error('state.json not found');
    process.exit(1);
}

const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
const cookies = state.cookies;

// Create the js code string for browser_run_code_unsafe
const code = `async (page) => {
  const cookies = ${JSON.stringify(cookies, null, 2)};
  await page.context().addCookies(cookies);
  await page.goto('https://mais.contaazul.com/#/clientes');
  return "Cookies injected successfully!";
}`;

fs.writeFileSync(path.resolve(__dirname, 'mcp_inject_code.txt'), code);
console.log('Successfully generated mcp_inject_code.txt');
