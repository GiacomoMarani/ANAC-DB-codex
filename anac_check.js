const puppeteer = require('puppeteer');
const path = require('path');

const SCREENSHOT_DIR = 'C:/Users/R&D/.gemini/antigravity/brain/fe507172-0a46-4291-ad1e-e178ad645236/scratch';

(async () => {
  // 1. Lancia Chrome visibile
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1920, height: 1080 },
    args: ['--start-maximized', '--auto-open-devtools-for-tabs']
  });

  const page = await browser.newPage();

  // 2. Vai al sito ANAC
  console.log('Navigazione verso dati.anticorruzione.it...');
  await page.goto('https://dati.anticorruzione.it/', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 5000));

  console.log('Titolo:', await page.title());
  console.log('URL:', page.url());

  // 3. Screenshot con DevTools aperto
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'anac_devtools.png'), fullPage: false });
  console.log('Screenshot 1 salvato: anac_devtools.png');

  // 4. Console log e errori
  const msgs = [];
  page.on('console', m => msgs.push({ type: m.type(), text: m.text() }));
  await page.reload({ waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 3000));

  console.log('\n=== CONSOLE ===');
  msgs.forEach(m => console.log(`[${m.type}] ${m.text}`));

  // 5. Screenshot finale
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'anac_final.png'), fullPage: false });
  console.log('\nScreenshot finale salvato: anac_final.png');

  console.log('\n✅ Chrome aperto con DevTools sul sito ANAC');
  console.log('Il browser resta aperto.');

  // Resta aperto
  await new Promise(() => {});
})();
