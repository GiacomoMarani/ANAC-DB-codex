import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { extractRelease, normalizeItem, formatCurrency, formatDate } from '../lib/normalize.js';
import { getApiBase } from '../lib/api.js';

export default function Contract() {
  const apiBase = getApiBase();
  const { ocid } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!ocid) return;

    let isActive = true;
    setLoading(true);
    setError('');
    fetch(`${apiBase}/api/contracts/${encodeURIComponent(ocid)}`)
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Request failed (${res.status})`);
        }
        return res.json();
      })
      .then((payload) => {
        if (isActive) {
          setData(payload);
        }
      })
      .catch((err) => {
        if (isActive) {
          setError(err.message);
        }
      })
      .finally(() => {
        if (isActive) {
          setLoading(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, [ocid]);

  const release = useMemo(() => extractRelease(data), [data]);
  const summary = useMemo(() => (release ? normalizeItem(release) : null), [release]);
  const hasValue = summary?.value !== null && summary?.value !== undefined && summary?.value !== '';

  const documents = useMemo(() => {
    if (!release) return [];
    const tenderDocs = release.tender?.documents || [];
    const contractDocs = (release.contracts || []).flatMap((item) => item.documents || []);
    return [...tenderDocs, ...contractDocs];
  }, [release]);

  const parties = release?.parties || [];
  const sourceUrl = release?.uri || release?.links?.self || data?.uri;

  return (
    <section className="contract-page">
      <Link className="back-link" to="/search">
        Back to results
      </Link>

      {loading && <div className="loading">Loading contract...</div>}
      {error && <div className="error">Error: {error}</div>}

      {!loading && !error && release && (
        <>
          <header className="contract-header">
            <div>
              <h1>{summary?.title || 'Contract detail'}</h1>
              <div className="meta">
                <span>OCID: {summary?.ocid || ocid}</span>
                <span>{summary?.date ? formatDate(summary.date) : 'Date n/a'}</span>
                <span>{summary?.authority || 'Authority n/a'}</span>
              </div>
            </div>
            <div className="value-pill">
              {hasValue
                ? formatCurrency(summary.value, summary.currency || 'EUR')
                : 'Value n/a'}
            </div>
          </header>

          <div className="detail-grid">
            <div className="detail-card">
              <h3>Overview</h3>
              <dl className="detail-list">
                <div>
                  <dt>Authority</dt>
                  <dd>{summary?.authority || 'n/a'}</dd>
                </div>
                <div>
                  <dt>Contractor</dt>
                  <dd>{summary?.contractor || 'n/a'}</dd>
                </div>
                <div>
                  <dt>Region</dt>
                  <dd>{summary?.region || 'n/a'}</dd>
                </div>
                <div>
                  <dt>Value</dt>
                  <dd>
                    {hasValue
                      ? formatCurrency(summary.value, summary.currency || 'EUR')
                      : 'n/a'}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="detail-card">
              <h3>Parties</h3>
              {parties.length ? (
                <ul className="tag-list">
                  {parties.map((party) => (
                    <li key={party.id || party.name} className="tag">
                      {party.name || party.id}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No party data available.</p>
              )}
            </div>

            <div className="detail-card">
              <h3>Documents</h3>
              {documents.length ? (
                <ul className="doc-list">
                  {documents.map((doc, index) => (
                    <li key={doc.id || doc.url || index}>
                      {doc.url ? (
                        <a href={doc.url} target="_blank" rel="noreferrer">
                          {doc.title || doc.documentType || doc.url}
                        </a>
                      ) : (
                        <span>{doc.title || doc.documentType || 'Document'}</span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No documents available.</p>
              )}
            </div>

            <div className="detail-card">
              <h3>Source</h3>
              {sourceUrl ? (
                <a href={sourceUrl} target="_blank" rel="noreferrer">
                  {sourceUrl}
                </a>
              ) : (
                <p>Source link not provided.</p>
              )}
            </div>
          </div>

          <details className="raw-data">
            <summary>Show raw OCDS data</summary>
            <pre>{JSON.stringify(release, null, 2)}</pre>
          </details>
        </>
      )}
    </section>
  );
}
