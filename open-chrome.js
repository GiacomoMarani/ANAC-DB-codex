const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: false,
    args: ['--auto-open-devtools-for-tabs', '--start-maximized'],
  });

  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();

  // Try Vercel deployment first
  await page.goto('https://anac-db-codex.vercel.app/', { waitUntil: 'domcontentloaded', timeout: 30000 });

  console.log('Chrome aperto con DevTools su Tender AI DB');
  console.log('URL:', page.url());
  console.log('Premi Ctrl+C nel terminale per chiudere.');

  // Keep browser open
  await new Promise(() => {});
})();
