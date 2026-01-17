import 'dotenv/config';
import express from 'express';
import cors from 'cors';

const app = express();
const port = process.env.PORT || 3001;
const frontendOrigin = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';
const searchUrl = process.env.ANAC_SEARCH_URL;
const detailTemplate = process.env.ANAC_DETAIL_URL;

app.use(cors({ origin: frontendOrigin }));
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

app.get('/api/search', async (req, res) => {
  if (!searchUrl) {
    return res.status(500).json({ error: 'ANAC_SEARCH_URL not configured' });
  }

  try {
    const url = new URL(searchUrl);
    for (const [key, value] of Object.entries(req.query)) {
      if (value !== undefined && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }

    const upstream = await fetch(url.toString(), {
      headers: { accept: 'application/json' }
    });

    const body = await upstream.text();
    res
      .status(upstream.status)
      .set('content-type', upstream.headers.get('content-type') || 'application/json')
      .send(body);
  } catch (err) {
    res.status(502).json({ error: 'Upstream request failed', detail: String(err) });
  }
});

app.get('/api/contracts/:ocid', async (req, res) => {
  if (!detailTemplate) {
    return res.status(500).json({ error: 'ANAC_DETAIL_URL not configured' });
  }

  try {
    const ocid = encodeURIComponent(req.params.ocid);
    const urlString = detailTemplate.replace('{ocid}', ocid);
    const url = new URL(urlString);
    for (const [key, value] of Object.entries(req.query)) {
      if (value !== undefined && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }

    const upstream = await fetch(url.toString(), {
      headers: { accept: 'application/json' }
    });

    const body = await upstream.text();
    res
      .status(upstream.status)
      .set('content-type', upstream.headers.get('content-type') || 'application/json')
      .send(body);
  } catch (err) {
    res.status(502).json({ error: 'Upstream request failed', detail: String(err) });
  }
});

app.listen(port, () => {
  console.log(`API proxy listening on http://localhost:${port}`);
});
