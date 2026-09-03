const { chromium } = require('playwright');

const WP_SITES = [
  'https://www.infobandi.it',
  'https://www.fareappalti.it',
  'https://www.banchedati.biz',
  'https://www.telemat.it',
  'https://procureplus.it',
  'https://tenderstool.com',
  'https://www.networkpa.it',
  'https://hermix.com',
];

const WP_ENDPOINTS = [
  '/wp-json/',                          // API root — lists all routes
  '/wp-json/wp/v2/posts?per_page=5',    // Recent posts
  '/wp-json/wp/v2/pages?per_page=5',    // Pages
  '/wp-json/wp/v2/categories?per_page=50', // Categories
  '/wp-json/wp/v2/tags?per_page=50',    // Tags
  '/wp-json/wp/v2/users',               // Users (often exposed!)
  '/wp-json/wp/v2/media?per_page=3',    // Media
  '/wp-json/wp/v2/search?search=appalti&per_page=5', // Search
  '/wp-json/wp/v2/types',               // Custom post types
  '/wp-json/oembed/1.0/embed?url=',     // oEmbed
  '/wp-json/yoast/v1/get_head?url=',    // Yoast SEO data
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  });
  const page = await ctx.newPage();

  for (const site of WP_SITES) {
    console.log(`\n${'#'.repeat(70)}`);
    console.log(`  WP REST API: ${site}`);
    console.log(`${'#'.repeat(70)}\n`);

    for (const endpoint of WP_ENDPOINTS) {
      const url = site + endpoint;
      try {
        const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
        if (!resp || resp.status() >= 400) {
          if (resp?.status() === 401 || resp?.status() === 403) {
            console.log(`  🔒 ${endpoint.substring(0, 50)} → ${resp.status()} (protected)`);
          }
          continue;
        }

        const ct = resp.headers()['content-type'] || '';
        if (!ct.includes('json')) continue;

        const body = await resp.text();
        let data;
        try { data = JSON.parse(body); } catch { continue; }

        if (endpoint === '/wp-json/') {
          // API root — extract available namespaces and routes
          const namespaces = data.namespaces || [];
          const routeCount = Object.keys(data.routes || {}).length;
          console.log(`  ✅ API ROOT → ${routeCount} routes, namespaces: ${namespaces.join(', ')}`);
          console.log(`     Site: ${data.name} — ${data.description?.substring(0, 80)}`);
        } else if (endpoint.includes('/users')) {
          if (Array.isArray(data) && data.length > 0) {
            console.log(`  ✅ USERS (${data.length}) →`);
            data.slice(0, 5).forEach(u => {
              console.log(`     id:${u.id} name:"${u.name}" slug:"${u.slug}" link:${u.link?.substring(0, 60)}`);
            });
          }
        } else if (endpoint.includes('/posts')) {
          if (Array.isArray(data) && data.length > 0) {
            console.log(`  ✅ POSTS (${data.length}) →`);
            data.slice(0, 3).forEach(p => {
              const title = p.title?.rendered?.replace(/<[^>]+>/g, '')?.substring(0, 80);
              console.log(`     [${p.date?.substring(0,10)}] "${title}" (${p.link?.substring(0, 60)})`);
            });
          }
        } else if (endpoint.includes('/pages')) {
          if (Array.isArray(data) && data.length > 0) {
            console.log(`  ✅ PAGES (${data.length}) →`);
            data.forEach(p => {
              const title = p.title?.rendered?.replace(/<[^>]+>/g, '')?.substring(0, 60);
              console.log(`     "${title}" → ${p.link?.substring(0, 70)}`);
            });
          }
        } else if (endpoint.includes('/categories')) {
          if (Array.isArray(data) && data.length > 0) {
            console.log(`  ✅ CATEGORIES (${data.length}) → ${data.map(c => `${c.name}(${c.count})`).join(', ').substring(0, 200)}`);
          }
        } else if (endpoint.includes('/tags')) {
          if (Array.isArray(data) && data.length > 0) {
            console.log(`  ✅ TAGS (${data.length}) → ${data.slice(0, 15).map(t => t.name).join(', ').substring(0, 200)}`);
          }
        } else if (endpoint.includes('/types')) {
          const types = Object.keys(data);
          console.log(`  ✅ POST TYPES → ${types.join(', ')}`);
        } else if (endpoint.includes('/search')) {
          if (Array.isArray(data) && data.length > 0) {
            console.log(`  ✅ SEARCH "appalti" (${data.length}) →`);
            data.forEach(r => {
              console.log(`     [${r.type}] "${r.title?.substring(0, 70)}" → ${r.url?.substring(0, 70)}`);
            });
          }
        }
      } catch(e) {}
    }
  }

  await browser.close();
  console.log('\n=== WP API SCAN COMPLETE ===');
})();
