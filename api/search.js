export default async function handler(req, res) {
  const searchUrl = process.env.ANAC_SEARCH_URL;
  if (!searchUrl) {
    return sendJson(res, 500, { error: 'ANAC_SEARCH_URL not configured' });
  }

  try {
    const url = new URL(searchUrl);
    applyQuery(url, req.query);

    const upstream = await fetch(url.toString(), {
      headers: { accept: 'application/json' }
    });

    const body = await upstream.text();
    res.statusCode = upstream.status;
    res.setHeader('content-type', upstream.headers.get('content-type') || 'application/json');
    res.end(body);
  } catch (err) {
    sendJson(res, 502, { error: 'Upstream request failed', detail: String(err) });
  }
}

function applyQuery(url, query) {
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value)) {
      value.forEach((entry) => {
        if (entry !== undefined && entry !== null && entry !== '') {
          url.searchParams.append(key, String(entry));
        }
      });
      return;
    }
    url.searchParams.set(key, String(value));
  });
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(payload));
}
