export default async function handler(req, res) {
  const awardsUrlTemplate = process.env.ANAC_AWARDS_TENDER_URL || process.env.ANAC_SEARCH_URL;
  const releasesByAwardUrl = process.env.ANAC_RELEASES_AWARD_URL;
  if (!awardsUrlTemplate) {
    return sendJson(res, 500, { error: 'ANAC_AWARDS_TENDER_URL not configured' });
  }

  const cig = getCigFromQuery(req.query);
  if (!cig) {
    return sendJson(res, 400, { error: 'Missing CIG parameter' });
  }

  try {
    const awardsUrl = buildAwardsUrl(awardsUrlTemplate, cig);
    if (isDebug(req.query)) {
      res.setHeader('x-upstream-url', awardsUrl.toString());
    }

    const awardsResponse = await fetch(awardsUrl.toString(), {
      headers: upstreamHeaders()
    });
    const awardsText = await awardsResponse.text();
    if (!awardsResponse.ok) {
      return sendJson(res, awardsResponse.status, {
        error: 'Upstream request failed',
        detail: clipText(awardsText)
      });
    }

    const awardsJson = safeJson(awardsText);
    if (!awardsJson) {
      return sendJson(res, 502, { error: 'Upstream returned non-JSON', detail: clipText(awardsText) });
    }

    const awards = normalizeArray(awardsJson);
    const awardIds = awards.map((award) => award?.id).filter(Boolean);

    if (!releasesByAwardUrl) {
      return sendJson(res, 200, awards);
    }

    const releases = [];
    const errors = [];
    for (const awardId of awardIds) {
      const releaseUrl = buildReleaseUrl(releasesByAwardUrl, awardId);
      if (isDebug(req.query) && releases.length === 0) {
        res.setHeader('x-upstream-release-url', releaseUrl.toString());
      }

      const releaseResponse = await fetch(releaseUrl.toString(), {
        headers: upstreamHeaders()
      });
      const releaseText = await releaseResponse.text();
      if (!releaseResponse.ok) {
        errors.push({
          id: awardId,
          status: releaseResponse.status,
          detail: clipText(releaseText)
        });
        continue;
      }

      const releaseJson = safeJson(releaseText);
      if (!releaseJson) {
        errors.push({ id: awardId, status: 502, detail: 'Non-JSON response' });
        continue;
      }
      releases.push(...normalizeArray(releaseJson));
    }

    if (!releases.length && errors.length) {
      return sendJson(res, 502, {
        error: 'Upstream request failed',
        detail: errors[0],
        awardsChecked: awardIds.length
      });
    }

    if (errors.length) {
      res.setHeader('x-upstream-partial-errors', String(errors.length));
    }
    return sendJson(res, 200, releases);
  } catch (err) {
    return sendJson(res, 502, { error: 'Upstream request failed', detail: String(err) });
  }
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(payload));
}

function pickFirstValue(value) {
  if (Array.isArray(value)) {
    return value.find((entry) => entry !== undefined && entry !== null && entry !== '');
  }
  if (value === undefined || value === null || value === '') return null;
  return String(value);
}

function normalizeCigValue(value) {
  return String(value).trim().replace(/^CIG\s*/i, '').replace(/\s+/g, '');
}

function isDebug(query) {
  const value = Array.isArray(query?.debug) ? query.debug[0] : query?.debug;
  return value === '1' || value === 'true';
}

function getCigFromQuery(query) {
  const raw = pickFirstValue(query?.cig ?? query?.q);
  return raw ? normalizeCigValue(raw) : '';
}

function buildAwardsUrl(template, cig) {
  if (template.includes('{id}')) {
    return new URL(template.replace('{id}', encodeURIComponent(cig)));
  }
  const url = new URL(template);
  url.searchParams.set('id', cig);
  return url;
}

function buildReleaseUrl(template, awardId) {
  if (template.includes('{id}')) {
    return new URL(template.replace('{id}', encodeURIComponent(awardId)));
  }
  const url = new URL(template);
  url.searchParams.set('id', awardId);
  return url;
}

function upstreamHeaders() {
  return {
    accept: 'application/json',
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0 Safari/537.36',
    'accept-language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7'
  };
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch (err) {
    return null;
  }
}

function normalizeArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.releases)) return payload.releases;
  if (Array.isArray(payload?.records)) return payload.records;
  if (Array.isArray(payload?.awards)) return payload.awards;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function clipText(text) {
  if (!text) return '';
  const trimmed = String(text);
  return trimmed.length > 500 ? `${trimmed.slice(0, 500)}…` : trimmed;
}
