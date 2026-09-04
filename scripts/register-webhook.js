#!/usr/bin/env node
/**
 * One-off admin script: registers (or updates) the bot's webhook URL via
 * the Zalo Bot Platform's `setWebhook` API
 * (https://bot.zaloplatforms.com/docs/apis/setWebhook/). Not part of the
 * running application — this is a setup-time tool, run manually whenever
 * the public webhook URL changes (new ngrok tunnel locally, new Vercel
 * domain in production).
 *
 * Usage:
 *   npm run webhook:register -- https://<public-domain>/webhook
 */
const fs = require('fs');
const path = require('path');

function loadEnvFile(filePath) {
  const result = {};
  if (!fs.existsSync(filePath)) return result;
  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    result[key] = value;
  }
  return result;
}

async function main() {
  const webhookUrl = process.argv[2];
  if (!webhookUrl) {
    console.error('Usage: npm run webhook:register -- <public-https-webhook-url>');
    console.error(
      'Example: npm run webhook:register -- https://abcd1234.ngrok-free.app/webhook',
    );
    process.exit(1);
  }

  const envFromFile = loadEnvFile(path.resolve(__dirname, '..', '.env'));
  const env = { ...envFromFile, ...process.env };

  const botToken = env.ZALO_BOT_TOKEN;
  const apiBaseUrl = env.ZALO_API_BASE_URL || 'https://bot-api.zaloplatforms.com/bot';
  const secretToken = env.WEBHOOK_SECRET_TOKEN;

  if (!botToken || botToken.includes('REPLACE_ME') || botToken.includes('your-zalo-bot-token')) {
    console.error('ZALO_BOT_TOKEN is missing or still a placeholder in .env');
    process.exit(1);
  }
  if (!secretToken) {
    console.error('WEBHOOK_SECRET_TOKEN is missing in .env');
    process.exit(1);
  }

  const endpoint = `${apiBaseUrl}${botToken}/setWebhook`;
  console.log(`Registering webhook URL: ${webhookUrl}`);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: webhookUrl, secret_token: secretToken }),
  });

  const body = await response.json().catch(() => ({}));
  console.log(`HTTP ${response.status}`);
  console.log(JSON.stringify(body, null, 2));

  if (!response.ok || body.ok === false) {
    console.error('Webhook registration failed — see response above.');
    process.exit(1);
  }
  console.log('Webhook registered successfully.');
}

main().catch((error) => {
  console.error('Unexpected error registering webhook:', error);
  process.exit(1);
});
