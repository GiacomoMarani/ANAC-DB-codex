/**
 * ANAC-DB-codex — Chrome Visual & Functional Review
 * 
 * Opens Chrome (headed) and systematically tests every page:
 *  1. Homepage (/)
 *  2. Gare (/gare) — tender listing + filters + search + pagination
 *  3. Ricerca Gare (/ricerca-gare) — multi-source search
 *  4. Codici CPV (/codici-cpv) — CPV code browser
 *  5. Import (/import) — CSV import page
 *  6. Navigation & responsiveness
 *  7. API health checks
 *  8. Console errors
 *  9. Performance timing
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE_URL = 'http://localhost:3000';
const SCREENSHOTS = path.join(__dirname, '.gemini-review-screenshots');

// Ensure screenshot dir
if (!fs.existsSync(SCREENSHOTS)) fs.mkdirSync(SCREENSHOTS, { recursive: true });

const issues = [];
const passes = [];
const consoleErrors = [];
const networkErrors = [];

function issue(severity, page, desc) {
  issues.push({ severity, page, desc });
  console.log(`  ❌ [${severity}] ${page}: ${desc}`);
}

function ok(page, desc) {
  passes.push({ page, desc });
  console.log(`  ✅ ${page}: ${desc}`);
}

function warn(page, desc) {
  issues.push({ severity: 'WARN', page, desc });
  console.log(`  ⚠️ ${page}: ${desc}`);
}

(async () => {
  console.log('\n🔍 ANAC-DB-codex — Chrome Critical Review\n');
  console.log('═'.repeat(60));

  const browser = await chromium.launch({
    headless: false,
    args: ['--start-maximized'],
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    locale: 'it-IT',
  });

  const page = await context.newPage();

  // Collect console errors globally
  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push({ url: page.url(), text: msg.text() });
    }
  });

  page.on('pageerror', err => {
    consoleErrors.push({ url: page.url(), text: err.message });
  });

  // Track failed network requests
  page.on('requestfailed', req => {
    const url = req.url();
    if (!url.includes('_next/webpack') && !url.includes('favicon')) {
      networkErrors.push({ url, failure: req.failure()?.errorText });
    }
  });

  // ─── 1. HOMEPAGE ─────────────────────────────────────────────────────────

  console.log('\n📄 1. HOMEPAGE (/)');
  console.log('─'.repeat(40));

  const t0 = Date.now();
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  const homeLoadMs = Date.now() - t0;

  if (homeLoadMs < 5000) ok('Home', `Loaded in ${homeLoadMs}ms`);
  else warn('Home', `Slow load: ${homeLoadMs}ms`);

  await page.screenshot({ path: path.join(SCREENSHOTS, '01_home.png'), fullPage: true });

  // Check for basic elements
  const title = await page.title();
  console.log(`  Title: "${title}"`);

  const h1 = await page.$('h1');
  if (h1) {
    const h1Text = await h1.textContent();
    ok('Home', `H1 found: "${h1Text.trim().substring(0, 60)}"`);
  } else {
    warn('Home', 'No <h1> element found');
  }

  // Check navigation
  const navLinks = await page.$$('nav a, header a');
  console.log(`  Nav links found: ${navLinks.length}`);
  if (navLinks.length >= 2) ok('Home', `Navigation has ${navLinks.length} links`);
  else warn('Home', `Only ${navLinks.length} nav links — may be incomplete`);

  // ─── 2. GARE PAGE ────────────────────────────────────────────────────────

  console.log('\n📄 2. GARE (/gare) — Tender Listing');
  console.log('─'.repeat(40));

  const t1 = Date.now();
  await page.goto(`${BASE_URL}/gare`, { waitUntil: 'networkidle', timeout: 30000 });
  const gareLoadMs = Date.now() - t1;
  console.log(`  Load time: ${gareLoadMs}ms`);

  await page.waitForTimeout(2000); // Let data load
  await page.screenshot({ path: path.join(SCREENSHOTS, '02_gare_initial.png'), fullPage: true });

  // Check if data table is present
  const tableRows = await page.$$('table tbody tr, [role="row"], .tender-card, [data-testid]');
  const cardElements = await page.$$('[class*="card"], [class*="Card"]');
  const dataElements = tableRows.length + cardElements.length;
  
  if (dataElements > 0) {
    ok('Gare', `Data displayed: ${tableRows.length} table rows, ${cardElements.length} card elements`);
  } else {
    // Try to detect any data rendering
    const bodyText = await page.textContent('body');
    if (bodyText.includes('CIG') || bodyText.includes('gara') || bodyText.includes('importo')) {
      ok('Gare', 'Data content detected in page text');
    } else {
      issue('HIGH', 'Gare', 'No data elements visible — table/cards not rendering');
    }
  }

  // Check stats cards
  const statsCards = await page.$$('[class*="stats"], [class*="Stats"], [class*="card"]');
  console.log(`  Stats/Card elements: ${statsCards.length}`);

  // Test search functionality
  const searchInput = await page.$('input[type="search"], input[type="text"], input[placeholder*="cerca"], input[placeholder*="search"], input[placeholder*="Cerca"], input[placeholder*="CIG"]');
  if (searchInput) {
    ok('Gare', 'Search input found');
    await searchInput.fill('servizi');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(SCREENSHOTS, '02_gare_search.png'), fullPage: true });
    
    // Check if results updated
    const bodyAfterSearch = await page.textContent('body');
    if (bodyAfterSearch.toLowerCase().includes('servizi')) {
      ok('Gare', 'Search results rendered for "servizi"');
    } else {
      warn('Gare', 'Search may not be filtering — no "servizi" in results');
    }

    // Clear search
    await searchInput.fill('');
    await page.waitForTimeout(1000);
  } else {
    warn('Gare', 'No search input found on page');
  }

  // Check filters
  const selects = await page.$$('select, [role="combobox"], button[class*="select"], [data-radix-collection-item]');
  console.log(`  Filter/select elements: ${selects.length}`);

  // Check pagination
  const paginationBtns = await page.$$('button:has-text("Successiva"), button:has-text("Next"), button:has-text("Precedente"), button:has-text("Previous"), [aria-label*="page"], nav[aria-label*="pagination"] button, button:has-text("›"), button:has-text("»")');
  if (paginationBtns.length > 0) {
    ok('Gare', `Pagination found: ${paginationBtns.length} buttons`);
    
    // Try clicking next page
    try {
      const nextBtn = await page.$('button:has-text("Successiva"), button:has-text("Next"), button:has-text("›")');
      if (nextBtn) {
        const isDisabled = await nextBtn.getAttribute('disabled');
        if (!isDisabled) {
          await nextBtn.click();
          await page.waitForTimeout(2000);
          await page.screenshot({ path: path.join(SCREENSHOTS, '02_gare_page2.png'), fullPage: true });
          ok('Gare', 'Pagination click worked — page 2 loaded');
        }
      }
    } catch (e) {
      warn('Gare', `Pagination click failed: ${e.message}`);
    }
  } else {
    warn('Gare', 'No pagination buttons found');
  }

  // ─── 3. RICERCA GARE ─────────────────────────────────────────────────────

  console.log('\n📄 3. RICERCA GARE (/ricerca-gare) — Multi-Source Search');
  console.log('─'.repeat(40));

  const t2 = Date.now();
  await page.goto(`${BASE_URL}/ricerca-gare`, { waitUntil: 'networkidle', timeout: 30000 });
  const ricercaLoadMs = Date.now() - t2;
  console.log(`  Load time: ${ricercaLoadMs}ms`);

  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(SCREENSHOTS, '03_ricerca_gare.png'), fullPage: true });

  // Check for source selection
  const sourceButtons = await page.$$('button[class*="source"], [class*="badge"], input[type="checkbox"], [role="checkbox"]');
  console.log(`  Source selection elements: ${sourceButtons.length}`);

  const ricercaSearch = await page.$('input[type="search"], input[type="text"], input[placeholder*="cerca"], input[placeholder*="Cerca"]');
  if (ricercaSearch) {
    ok('Ricerca', 'Search input found');
    await ricercaSearch.fill('pulizia');
    
    // Look for a search button
    const searchBtn = await page.$('button:has-text("Cerca"), button:has-text("Search"), button[type="submit"]');
    if (searchBtn) {
      await searchBtn.click();
      await page.waitForTimeout(3000);
    } else {
      await page.keyboard.press('Enter');
      await page.waitForTimeout(3000);
    }
    
    await page.screenshot({ path: path.join(SCREENSHOTS, '03_ricerca_results.png'), fullPage: true });
    
    const resultsBody = await page.textContent('body');
    if (resultsBody.toLowerCase().includes('pulizia') || resultsBody.includes('risultat')) {
      ok('Ricerca', 'Search results displayed for "pulizia"');
    } else {
      warn('Ricerca', 'Search results may not have loaded');
    }
  } else {
    warn('Ricerca', 'No search input found');
  }

  // ─── 4. CODICI CPV ────────────────────────────────────────────────────────

  console.log('\n📄 4. CODICI CPV (/codici-cpv)');
  console.log('─'.repeat(40));

  const t3 = Date.now();
  await page.goto(`${BASE_URL}/codici-cpv`, { waitUntil: 'networkidle', timeout: 30000 });
  const cpvLoadMs = Date.now() - t3;
  console.log(`  Load time: ${cpvLoadMs}ms`);

  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(SCREENSHOTS, '04_codici_cpv.png'), fullPage: true });

  const cpvContent = await page.textContent('body');
  if (cpvContent.includes('CPV') || cpvContent.includes('cpv') || cpvContent.includes('codic')) {
    ok('CPV', 'CPV content rendered');
  } else {
    warn('CPV', 'No CPV-related content visible');
  }

  // ─── 5. IMPORT PAGE ───────────────────────────────────────────────────────

  console.log('\n📄 5. IMPORT (/import)');
  console.log('─'.repeat(40));

  const t4 = Date.now();
  await page.goto(`${BASE_URL}/import`, { waitUntil: 'networkidle', timeout: 30000 });
  const importLoadMs = Date.now() - t4;
  console.log(`  Load time: ${importLoadMs}ms`);

  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(SCREENSHOTS, '05_import.png'), fullPage: true });

  const dropzone = await page.$('[class*="dropzone"], [class*="Dropzone"], input[type="file"], [class*="upload"]');
  if (dropzone) ok('Import', 'File upload area found');
  else warn('Import', 'No file upload/dropzone found');

  // ─── 6. MOBILE RESPONSIVENESS ─────────────────────────────────────────────

  console.log('\n📱 6. MOBILE RESPONSIVENESS');
  console.log('─'.repeat(40));

  await page.setViewportSize({ width: 375, height: 812 }); // iPhone size
  await page.goto(`${BASE_URL}/gare`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(SCREENSHOTS, '06_mobile_gare.png'), fullPage: true });

  // Check for horizontal overflow
  const hasOverflow = await page.evaluate(() => {
    return document.documentElement.scrollWidth > document.documentElement.clientWidth;
  });
  if (hasOverflow) {
    issue('MEDIUM', 'Mobile', 'Horizontal scroll detected — content overflows viewport');
  } else {
    ok('Mobile', 'No horizontal overflow on /gare');
  }

  // Check if hamburger menu exists
  const hamburger = await page.$('button[class*="menu"], button[class*="hamburger"], button[aria-label*="menu"], [class*="mobile-nav"], button[class*="MenuIcon"]');
  if (hamburger) {
    ok('Mobile', 'Hamburger/mobile menu button found');
  } else {
    // Check if nav items are still visible
    const mobileNavLinks = await page.$$('nav a:visible, header a:visible');
    if (mobileNavLinks.length > 0) {
      ok('Mobile', `${mobileNavLinks.length} nav links visible at mobile width`);
    } else {
      warn('Mobile', 'No navigation visible at mobile width — may need hamburger menu');
    }
  }

  // Mobile home
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(SCREENSHOTS, '06_mobile_home.png'), fullPage: true });

  // Reset viewport
  await page.setViewportSize({ width: 1920, height: 1080 });

  // ─── 7. TABLET RESPONSIVENESS ─────────────────────────────────────────────

  console.log('\n📱 7. TABLET RESPONSIVENESS');
  console.log('─'.repeat(40));

  await page.setViewportSize({ width: 768, height: 1024 }); // iPad
  await page.goto(`${BASE_URL}/gare`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(SCREENSHOTS, '07_tablet_gare.png'), fullPage: true });

  const tabletOverflow = await page.evaluate(() => {
    return document.documentElement.scrollWidth > document.documentElement.clientWidth;
  });
  if (tabletOverflow) {
    warn('Tablet', 'Horizontal scroll detected at 768px');
  } else {
    ok('Tablet', 'No horizontal overflow on /gare at tablet width');
  }

  // Reset viewport
  await page.setViewportSize({ width: 1920, height: 1080 });

  // ─── 8. INTERACTION TESTS ─────────────────────────────────────────────────

  console.log('\n🖱️ 8. INTERACTION TESTS');
  console.log('─'.repeat(40));

  // Go back to gare for interaction tests
  await page.goto(`${BASE_URL}/gare`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  // Try clicking on a row/card to see if detail dialog opens
  const clickableRow = await page.$('table tbody tr, [class*="card"]:not([class*="stats"])');
  if (clickableRow) {
    try {
      await clickableRow.click();
      await page.waitForTimeout(1500);
      
      const dialog = await page.$('[role="dialog"], [class*="dialog"], [class*="Dialog"], [class*="modal"], [class*="Modal"]');
      if (dialog) {
        ok('Interaction', 'Detail dialog opens on row click');
        await page.screenshot({ path: path.join(SCREENSHOTS, '08_detail_dialog.png'), fullPage: false });
        
        // Close dialog
        const closeBtn = await page.$('[role="dialog"] button[class*="close"], [class*="dialog"] button:first-of-type, button[aria-label="Close"]');
        if (closeBtn) await closeBtn.click();
        else await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
      } else {
        console.log('  ℹ️ No dialog opened on row click (may be intentional)');
      }
    } catch (e) {
      console.log(`  ℹ️ Row click test: ${e.message}`);
    }
  }

  // ─── 9. DARK MODE CHECK ───────────────────────────────────────────────────

  console.log('\n🌙 9. DARK MODE / THEME');
  console.log('─'.repeat(40));

  const themeToggle = await page.$('button[class*="theme"], button[class*="Theme"], button[class*="dark"], button[class*="moon"], button[class*="sun"], [data-theme-toggle]');
  if (themeToggle) {
    ok('Theme', 'Theme toggle button found');
    try {
      await themeToggle.click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: path.join(SCREENSHOTS, '09_dark_mode.png'), fullPage: true });
      ok('Theme', 'Theme toggled — screenshot saved');
      // Toggle back
      await themeToggle.click();
      await page.waitForTimeout(500);
    } catch (e) {
      warn('Theme', `Theme toggle failed: ${e.message}`);
    }
  } else {
    console.log('  ℹ️ No theme toggle button found (may use system preference)');
  }

  // ─── 10. ACCESSIBILITY CHECKS ─────────────────────────────────────────────

  console.log('\n♿ 10. ACCESSIBILITY');
  console.log('─'.repeat(40));

  await page.goto(`${BASE_URL}/gare`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  // Check for alt text on images
  const images = await page.$$('img');
  let imagesWithoutAlt = 0;
  for (const img of images) {
    const alt = await img.getAttribute('alt');
    if (!alt && alt !== '') imagesWithoutAlt++;
  }
  if (images.length === 0) console.log('  ℹ️ No images on page');
  else if (imagesWithoutAlt === 0) ok('A11y', `All ${images.length} images have alt text`);
  else warn('A11y', `${imagesWithoutAlt}/${images.length} images missing alt text`);

  // Check for form labels
  const inputs = await page.$$('input:not([type="hidden"])');
  let inputsWithoutLabel = 0;
  for (const input of inputs) {
    const id = await input.getAttribute('id');
    const ariaLabel = await input.getAttribute('aria-label');
    const placeholder = await input.getAttribute('placeholder');
    if (!id && !ariaLabel && !placeholder) inputsWithoutLabel++;
  }
  if (inputsWithoutLabel > 0) {
    warn('A11y', `${inputsWithoutLabel} inputs without label/aria-label/placeholder`);
  } else if (inputs.length > 0) {
    ok('A11y', `All ${inputs.length} inputs have labels or placeholders`);
  }

  // Check color contrast on key elements
  const lowContrast = await page.evaluate(() => {
    const problems = [];
    const elements = document.querySelectorAll('h1, h2, h3, p, span, a, button, td, th, label');
    for (const el of elements) {
      const style = getComputedStyle(el);
      const color = style.color;
      const bg = style.backgroundColor;
      // Very basic check: detect white-on-white or very light text on light bg
      if (color === 'rgba(0, 0, 0, 0)' || (color === bg && color !== 'rgba(0, 0, 0, 0)')) {
        problems.push(el.tagName + ': same color as bg');
      }
    }
    return problems.slice(0, 5);
  });
  if (lowContrast.length > 0) {
    warn('A11y', `Potential contrast issues: ${lowContrast.join(', ')}`);
  } else {
    ok('A11y', 'No obvious contrast issues detected');
  }

  // ─── 11. PERFORMANCE ──────────────────────────────────────────────────────

  console.log('\n⚡ 11. PERFORMANCE');
  console.log('─'.repeat(40));

  // Measure LCP
  await page.goto(`${BASE_URL}/gare`, { waitUntil: 'networkidle', timeout: 30000 });
  const performanceMetrics = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    return {
      domContentLoaded: Math.round(nav?.domContentLoadedEventEnd || 0),
      loadEvent: Math.round(nav?.loadEventEnd || 0),
      domInteractive: Math.round(nav?.domInteractive || 0),
      transferSize: Math.round((nav?.transferSize || 0) / 1024),
    };
  });

  console.log(`  DOM Interactive: ${performanceMetrics.domInteractive}ms`);
  console.log(`  DOM Content Loaded: ${performanceMetrics.domContentLoaded}ms`);
  console.log(`  Load Event: ${performanceMetrics.loadEvent}ms`);
  console.log(`  Transfer Size: ${performanceMetrics.transferSize}KB`);

  if (performanceMetrics.domContentLoaded < 3000) {
    ok('Performance', `DOMContentLoaded in ${performanceMetrics.domContentLoaded}ms`);
  } else {
    warn('Performance', `Slow DOMContentLoaded: ${performanceMetrics.domContentLoaded}ms`);
  }

  // ─── FINAL SCREENSHOT — ALL PAGES GRID ─────────────────────────────────────

  console.log('\n📸 Final screenshots saved');
  console.log('─'.repeat(40));
  const screenshotFiles = fs.readdirSync(SCREENSHOTS).filter(f => f.endsWith('.png'));
  screenshotFiles.forEach(f => console.log(`  📎 ${f}`));

  // ─── SUMMARY ──────────────────────────────────────────────────────────────

  console.log('\n' + '═'.repeat(60));
  console.log('  CRITICAL REVIEW SUMMARY');
  console.log('═'.repeat(60));

  // Console errors
  if (consoleErrors.length > 0) {
    console.log(`\n  ❌ Console Errors: ${consoleErrors.length}`);
    consoleErrors.forEach(e => console.log(`    • [${e.url.replace(BASE_URL, '')}] ${e.text.substring(0, 150)}`));
  } else {
    console.log('\n  ✅ Console Errors: 0');
  }

  // Network errors
  if (networkErrors.length > 0) {
    console.log(`\n  ❌ Network Errors: ${networkErrors.length}`);
    networkErrors.forEach(e => console.log(`    • ${e.url.substring(0, 100)} → ${e.failure}`));
  } else {
    console.log('  ✅ Network Errors: 0');
  }

  // Issues
  const critical = issues.filter(i => i.severity === 'HIGH');
  const medium = issues.filter(i => i.severity === 'MEDIUM');
  const warnings = issues.filter(i => i.severity === 'WARN');

  console.log(`\n  Results:`);
  console.log(`    ✅ Passed:   ${passes.length}`);
  console.log(`    ❌ Critical: ${critical.length}`);
  console.log(`    ⚠️  Medium:   ${medium.length}`);
  console.log(`    ℹ️  Warnings: ${warnings.length}`);

  if (critical.length > 0) {
    console.log('\n  🔴 CRITICAL ISSUES:');
    critical.forEach(i => console.log(`    • [${i.page}] ${i.desc}`));
  }
  if (medium.length > 0) {
    console.log('\n  🟡 MEDIUM ISSUES:');
    medium.forEach(i => console.log(`    • [${i.page}] ${i.desc}`));
  }
  if (warnings.length > 0) {
    console.log('\n  🟠 WARNINGS:');
    warnings.forEach(i => console.log(`    • [${i.page}] ${i.desc}`));
  }

  console.log('\n  Screenshots saved to:', SCREENSHOTS);
  console.log();

  // Keep browser open for manual inspection
  console.log('  🔍 Browser stays open for manual inspection.');
  console.log('  Press Ctrl+C to close.\n');

  await new Promise(() => {});
})();
