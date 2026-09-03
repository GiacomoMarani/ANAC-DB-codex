const { chromium } = require('playwright');

const FEEDS = [
  { name: 'InfoBandiPA', url: 'https://www.infobandi.it/feed/' },
  { name: 'FareAppalti', url: 'https://www.fareappalti.it/feed/' },
  { name: 'Banchedati', url: 'https://www.banchedati.biz/feed/' },
  { name: 'Telemat', url: 'https://www.telemat.it/feed/' },
  { name: 'TendersTool', url: 'https://tenderstool.com/feed/' },
  { name: 'NetworkPA', url: 'https://www.networkpa.it/feed/' },
  { name: 'Hermix', url: 'https://hermix.com/feed/' },
  { name: 'Tenderlake', url: 'https://www.tenderlake.com/feed/rss' },
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  for (const feed of FEEDS) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`  RSS: ${feed.name} — ${feed.url}`);
    console.log(`${'='.repeat(70)}\n`);

    try {
      const resp = await page.goto(feed.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      if (!resp || resp.status() >= 400) { console.log(`FAIL: ${resp?.status()}`); continue; }

      const ct = resp.headers()['content-type'] || '';
      const body = await resp.text();
      console.log(`Content-Type: ${ct} | Size: ${body.length} bytes`);

      // Parse RSS items
      const titleMatch = body.match(/<channel>[\s\S]*?<title>([\s\S]*?)<\/title>/);
      console.log(`Channel: ${titleMatch?.[1]?.replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1')?.trim() || 'N/A'}`);

      const items = body.match(/<item>[\s\S]*?<\/item>/g) || [];
      console.log(`Items: ${items.length}\n`);

      items.slice(0, 8).forEach((item, i) => {
        const t = item.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1')?.trim() || '';
        const link = item.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim() || '';
        const date = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() || '';
        const cats = (item.match(/<category[^>]*>([\s\S]*?)<\/category>/g) || [])
          .map(c => c.replace(/<category[^>]*>([\s\S]*?)<\/category>/, '$1').replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim())
          .join(', ');
        const desc = item.match(/<description>([\s\S]*?)<\/description>/)?.[1]
          ?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
          ?.replace(/<[^>]+>/g, '')?.trim()?.substring(0, 150) || '';

        console.log(`  [${i+1}] ${t.substring(0, 100)}`);
        console.log(`      Date: ${date}`);
        if (cats) console.log(`      Categories: ${cats}`);
        if (link) console.log(`      Link: ${link.substring(0, 100)}`);
        if (desc) console.log(`      Desc: ${desc}`);
        console.log();
      });

    } catch(e) {
      console.log(`ERROR: ${e.message.substring(0, 100)}`);
    }
  }

  await browser.close();
  console.log('\n=== RSS SCAN COMPLETE ===');
})();
