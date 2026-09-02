const { chromium } = require('playwright');

const screenshotPath = process.argv[2] || 'screenshot.png';

(async () => {
  let browser;
  try {
    console.log('Launching Chromium browser (headed mode)...');
    browser = await chromium.launch({ 
      headless: false,
      timeout: 30000 
    });
    
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 }
    });
    const page = await context.newPage();
    
    // Try the /gare route first
    console.log('Navigating to https://anac-db-codex.vercel.app/gare ...');
    let response;
    try {
      response = await page.goto('https://anac-db-codex.vercel.app/gare', { 
        waitUntil: 'networkidle',
        timeout: 30000 
      });
      console.log(`Response status: ${response?.status()}`);
    } catch (e) {
      console.log(`Failed to load /gare: ${e.message}`);
      console.log('Trying base URL instead...');
      response = await page.goto('https://anac-db-codex.vercel.app/', { 
        waitUntil: 'networkidle',
        timeout: 30000 
      });
      console.log(`Response status: ${response?.status()}`);
    }
    
    // Wait a bit for any dynamic content
    await page.waitForTimeout(3000);
    
    // Get page title
    const title = await page.title();
    console.log(`Page title: "${title}"`);
    
    // Get page URL
    const url = page.url();
    console.log(`Current URL: ${url}`);
    
    // Take screenshot
    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log(`Screenshot saved to: ${screenshotPath}`);
    
    // Get visible text content (first 3000 chars)
    const bodyText = await page.evaluate(() => {
      return document.body?.innerText?.substring(0, 3000) || 'No body text found';
    });
    console.log('\n--- PAGE CONTENT (first 3000 chars) ---');
    console.log(bodyText);
    console.log('--- END PAGE CONTENT ---');
    
    // Get all links on the page
    const links = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a[href]'))
        .slice(0, 30)
        .map(a => ({ text: a.innerText.trim(), href: a.href }));
    });
    console.log('\n--- LINKS ON PAGE ---');
    links.forEach(l => console.log(`  [${l.text}] -> ${l.href}`));
    console.log('--- END LINKS ---');
    
    // Keep the browser open for 5 seconds so user can see it
    console.log('\nKeeping browser open for 5 seconds...');
    await page.waitForTimeout(5000);
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    if (browser) {
      await browser.close();
      console.log('Browser closed.');
    }
  }
})();
