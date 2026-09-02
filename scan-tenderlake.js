const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });
  const page = await ctx.newPage();

  const allXhr = [];
  page.on('request', req => {
    const t = req.resourceType();
    if (t === 'xhr' || t === 'fetch') {
      const u = req.url();
      if (!u.includes('google') && !u.includes('facebook') && !u.includes('clarity') && !u.includes('linkedin') && !u.includes('bing')) {
        allXhr.push({ url: u, method: req.method(), post: req.postData()?.substring(0, 300) });
      }
    }
  });

  const pages = [
    { url: 'https://www.tenderlake.com/', label: 'Homepage' },
    { url: 'https://www.tenderlake.com/products/monitor', label: 'Monitor Product' },
    { url: 'https://www.tenderlake.com/products/analyst', label: 'Analyst Product' },
    { url: 'https://www.tenderlake.com/products/api', label: 'API Product' },
    { url: 'https://www.tenderlake.com/home/about', label: 'About' },
    { url: 'https://www.tenderlake.com/home/contact', label: 'Contact' },
    { url: 'https://www.tenderlake.com/home/contact?demo=analyst', label: 'Demo Request' },
    { url: 'https://www.tenderlake.com/news/index', label: 'News' },
    { url: 'https://www.tenderlake.com/pricing', label: 'Pricing (guess)' },
    { url: 'https://www.tenderlake.com/plans', label: 'Plans (guess)' },
    { url: 'https://app.tenderlake.com/', label: 'App Login' },
    { url: 'https://app.tenderlake.com/Account/Register', label: 'App Register' },
  ];

  for (const p of pages) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`  ${p.label} — ${p.url}`);
    console.log(`${'='.repeat(70)}\n`);

    try {
      const resp = await page.goto(p.url, { waitUntil: 'networkidle', timeout: 20000 });
      if (!resp) { console.log('No response'); continue; }
      console.log(`Status: ${resp.status()} | Final URL: ${page.url()}`);
      console.log(`Title: ${await page.title()}`);

      // Page text content (structured)
      const content = await page.evaluate(() => {
        const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4')).map(h => `${h.tagName}: ${h.textContent?.trim()?.substring(0, 120)}`);
        
        // Get all paragraphs with substantial text
        const paragraphs = Array.from(document.querySelectorAll('p'))
          .map(p => p.textContent?.trim())
          .filter(t => t && t.length > 30)
          .slice(0, 10)
          .map(t => t.substring(0, 200));

        // Get all links
        const links = Array.from(document.querySelectorAll('a[href]'))
          .map(a => ({ text: a.textContent?.trim()?.substring(0, 50), href: a.href }))
          .filter(l => l.text && l.text.length > 1 && !l.href.startsWith('javascript:'))
          .slice(0, 20);

        // Forms
        const forms = Array.from(document.querySelectorAll('form')).map(f => ({
          action: f.action?.substring(0, 150),
          method: f.method,
          inputs: Array.from(f.querySelectorAll('input,select,textarea')).map(i => ({
            name: i.name, type: i.type, placeholder: i.placeholder?.substring(0, 50),
            options: i.tagName === 'SELECT' ? Array.from(i.options).slice(0, 10).map(o => `${o.value}:${o.text?.trim()?.substring(0, 30)}`).join(' | ') : undefined,
          })).filter(i => i.name),
        }));

        // Pricing elements
        const pricing = document.body?.innerText?.match(/(€|EUR|USD|\$|£)\s*[\d.,]+[\s/]*(month|year|anno|mese|user|utente)?/gi)?.slice(0, 10) || [];
        const pricingAlt = document.body?.innerText?.match(/\d+[\s.]*(€|EUR|USD)/gi)?.slice(0, 10) || [];

        // Bullet lists (feature lists)
        const lists = Array.from(document.querySelectorAll('ul li, ol li'))
          .map(li => li.textContent?.trim()?.substring(0, 100))
          .filter(t => t && t.length > 10)
          .slice(0, 15);

        return { headings, paragraphs, links, forms, pricing: [...pricing, ...pricingAlt], lists };
      });

      if (content.headings.length) {
        console.log('\nHeadings:');
        content.headings.forEach(h => console.log(`  ${h}`));
      }
      if (content.paragraphs.length) {
        console.log('\nKey paragraphs:');
        content.paragraphs.forEach(p => console.log(`  > ${p}`));
      }
      if (content.links.length) {
        console.log('\nLinks:');
        content.links.forEach(l => console.log(`  ${l.text} → ${l.href.substring(0, 100)}`));
      }
      if (content.forms.length) {
        console.log('\nForms:');
        content.forms.forEach(f => {
          console.log(`  ${f.method} ${f.action}`);
          f.inputs.forEach(i => {
            let info = `    ${i.name} (${i.type})`;
            if (i.placeholder) info += ` "${i.placeholder}"`;
            if (i.options) info += ` [${i.options}]`;
            console.log(info);
          });
        });
      }
      if (content.pricing.length) {
        console.log('\nPricing found:', content.pricing.join(', '));
      }
      if (content.lists.length) {
        console.log('\nFeature list:');
        content.lists.forEach(li => console.log(`  • ${li}`));
      }

    } catch(e) {
      console.log(`Error: ${e.message.substring(0, 150)}`);
    }
  }

  // Check API documentation pages
  console.log(`\n${'#'.repeat(70)}`);
  console.log('  ADDITIONAL API/DOCS EXPLORATION');
  console.log(`${'#'.repeat(70)}\n`);

  const extraPaths = [
    '/api/v1', '/api/v2', '/api/docs', '/api/swagger', '/swagger',
    '/docs', '/documentation', '/developer', '/developers',
    '/products/api/docs', '/products/api/documentation',
    '/Account/Login', '/Account/ForgotPassword',
    '/search', '/tenders', '/opportunities',
    '/feed', '/rss', '/sitemap.xml',
  ];

  for (const path of extraPaths) {
    try {
      const baseUrl = path.includes('Account') ? 'https://app.tenderlake.com' : 'https://www.tenderlake.com';
      const resp = await page.goto(`${baseUrl}${path}`, { waitUntil: 'domcontentloaded', timeout: 10000 });
      if (resp && resp.status() < 400) {
        const ct = resp.headers()['content-type'] || '';
        const title = await page.title().catch(() => '');
        const bodyLen = (await resp.text().catch(() => '')).length;
        console.log(`✅ ${baseUrl}${path} → ${resp.status()} (${ct.substring(0, 40)}) [${bodyLen}b] "${title}"`);

        // If it's JSON or XML, show preview
        if (ct.includes('json') || ct.includes('xml') || ct.includes('rss')) {
          const body = await page.evaluate(() => document.body?.innerText?.substring(0, 500));
          console.log(`   Preview: ${body?.substring(0, 300)}`);
        }
      } else if (resp) {
        console.log(`❌ ${baseUrl}${path} → ${resp.status()}`);
      }
    } catch(e) {}
  }

  // XHR/Fetch summary
  if (allXhr.length) {
    console.log(`\n=== XHR/FETCH CALLS (${allXhr.length}) ===`);
    allXhr.forEach(x => {
      console.log(`  ${x.method} ${x.url.substring(0, 150)}`);
      if (x.post) console.log(`    POST: ${x.post.substring(0, 200)}`);
    });
  }

  // Check app.tenderlake.com structure
  console.log('\n\n=== APP STRUCTURE ===\n');
  try {
    await page.goto('https://app.tenderlake.com/', { waitUntil: 'networkidle', timeout: 15000 });
    console.log(`Title: ${await page.title()}`);
    console.log(`URL: ${page.url()}`);

    const appContent = await page.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll('script[src]')).map(s => s.src);
      const links = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(l => l.href);
      const metas = {};
      document.querySelectorAll('meta').forEach(m => {
        const n = m.getAttribute('name') || m.getAttribute('property');
        const c = m.getAttribute('content');
        if (n && c) metas[n] = c.substring(0, 100);
      });
      const forms = Array.from(document.querySelectorAll('form')).map(f => ({
        action: f.action?.substring(0, 150),
        method: f.method,
        inputs: Array.from(f.querySelectorAll('input')).map(i => ({ name: i.name, type: i.type, placeholder: i.placeholder })).filter(i => i.name),
      }));
      const headings = Array.from(document.querySelectorAll('h1,h2,h3')).map(h => h.textContent?.trim()?.substring(0, 100));
      return { scripts: scripts.slice(0, 10), links: links.slice(0, 5), metas, forms, headings };
    });

    console.log('\nScripts:', appContent.scripts.map(s => s.substring(s.lastIndexOf('/') + 1, s.lastIndexOf('/') + 60)).join('\n  '));
    console.log('\nMetas:', JSON.stringify(appContent.metas, null, 2));
    if (appContent.forms.length) {
      console.log('\nForms:');
      appContent.forms.forEach(f => {
        console.log(`  ${f.method} ${f.action}`);
        f.inputs.forEach(i => console.log(`    ${i.name} (${i.type}) "${i.placeholder || ''}"`));
      });
    }
    if (appContent.headings.length) {
      console.log('\nHeadings:', appContent.headings.join(' | '));
    }
  } catch(e) {
    console.log('Error:', e.message.substring(0, 150));
  }

  // Cookies for app
  const cookies = await ctx.cookies();
  const appCookies = cookies.filter(c => c.domain.includes('tenderlake'));
  console.log(`\nTenderlake cookies (${appCookies.length}):`);
  appCookies.forEach(c => console.log(`  ${c.name}=${c.value.substring(0, 60)} [${c.domain}] path=${c.path}`));

  await browser.close();
  console.log('\n=== DONE ===');
})();
