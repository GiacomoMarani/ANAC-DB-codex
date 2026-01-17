export default async function handler(req, res) {
  const detailTemplate = process.env.ANAC_DETAIL_URL;
  if (!detailTemplate) {
    return sendJson(res, 500, { error: 'ANAC_DETAIL_URL not configured' });
  }

  const ocidParam = Array.isArray(req.query.ocid) ? req.query.ocid[0] : req.query.ocid;
  if (!ocidParam) {
    return sendJson(res, 400, { error: 'Missing ocid parameter' });
  }

  try {
    const ocid = encodeURIComponent(ocidParam);
    const urlString = detailTemplate.replace('{ocid}', ocid);
    const url = new URL(urlString);
    applyQuery(url, req.query, ['ocid']);

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

function applyQuery(url, query, skipKeys) {
  const skip = new Set(skipKeys || []);
  Object.entries(query || {}).forEach(([key, value]) => {
    if (skip.has(key)) return;
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
