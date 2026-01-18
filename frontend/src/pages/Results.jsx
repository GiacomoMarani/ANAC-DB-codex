import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import SearchBar from '../components/SearchBar.jsx';
import ResultCard from '../components/ResultCard.jsx';
import { extractItems, normalizeItem, formatCurrency } from '../lib/normalize.js';
import { getApiBase } from '../lib/api.js';
import { normalizeCigInput } from '../lib/cig.js';

export default function Results() {
  const apiBase = getApiBase();
  const [searchParams, setSearchParams] = useSearchParams();
  const cigParam = searchParams.get('cig') || searchParams.get('q') || '';
  const [query, setQuery] = useState(cigParam);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const hasCig = Boolean(cigParam);

  useEffect(() => {
    setQuery(cigParam);
  }, [cigParam]);

  useEffect(() => {
    if (!hasCig) return;

    let isActive = true;
    setLoading(true);
    setError('');
    fetch(`${apiBase}/api/search?${searchParams.toString()}`)
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
  }, [apiBase, searchParams, hasCig]);

  const items = useMemo(() => extractItems(data).map(normalizeItem), [data]);

  const stats = useMemo(() => {
    const amounts = items.map((item) => item.value).filter((value) => typeof value === 'number');
    const totalAmount = amounts.length ? amounts.reduce((sum, value) => sum + value, 0) : null;
    const maxAmount = amounts.length ? Math.max(...amounts) : null;
    const minAmount = amounts.length ? Math.min(...amounts) : null;

    return {
      count: items.length,
      totalAmount,
      maxAmount,
      minAmount
    };
  }, [items]);

  const totalFromApi =
    data?.total || data?.count || data?.records?.length || data?.releases?.length;

  const handleSubmit = (value) => {
    const next = normalizeCigInput(value);
    if (!next) return;
    const nextParams = new URLSearchParams();
    nextParams.set('cig', next);
    setSearchParams(nextParams, { replace: true });
  };

  const handleExport = () => {
    if (!items.length) return;
    const header = [
      'ocid',
      'cig',
      'title',
      'authority',
      'contractor',
      'value',
      'currency',
      'date',
      'region'
    ];
    const rows = items.map((item) => [
      item.ocid || '',
      item.cig || '',
      item.title || '',
      item.authority || '',
      item.contractor || '',
      item.value ?? '',
      item.currency || '',
      item.date || '',
      item.region || ''
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => csvEscape(cell)).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'anac-results.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="results-page">
      <div className="results-top">
        <SearchBar
          value={query}
          onChange={setQuery}
          onSubmit={handleSubmit}
          placeholder="Search by CIG / item ID (e.g. 822799329F)"
        />
        <div className="results-actions">
          <button type="button" className="ghost-button" onClick={handleExport}>
            Export CSV
          </button>
        </div>
      </div>

      <div className="results-layout">
        <aside className="filters">
          <div className="cig-help">
            <h3>Search by CIG</h3>
            <p>Enter the CIG (item ID) to retrieve the releases linked to that tender.</p>
            <div className="example-list">
              <button type="button" className="example-chip" onClick={() => handleSubmit('822799329F')}>
                822799329F
              </button>
              <button type="button" className="example-chip" onClick={() => handleSubmit('7701655')}>
                7701655
              </button>
            </div>
          </div>
        </aside>

        <div className="results-content">
          <div className="insights">
            <div className="stat-card">
              <span className="stat-label">Results</span>
              <span className="stat-value">{totalFromApi || stats.count}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Total value</span>
              <span className="stat-value">
                {stats.totalAmount !== null ? formatCurrency(stats.totalAmount, 'EUR') : 'n/a'}
              </span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Value range</span>
              <span className="stat-value">
                {stats.minAmount !== null && stats.maxAmount !== null
                  ? `${formatCurrency(stats.minAmount, 'EUR')} - ${formatCurrency(
                      stats.maxAmount,
                      'EUR'
                    )}`
                  : 'n/a'}
              </span>
            </div>
          </div>

          {loading && <div className="loading">Loading results...</div>}
          {error && <div className="error">Error: {error}</div>}
          {!hasCig && (
            <div className="empty-state">
              <h3>Insert a CIG to start</h3>
              <p>Use the search bar to look up releases for a specific tender.</p>
            </div>
          )}

          {hasCig && !loading && !error && !items.length && (
            <div className="empty-state">
              <h3>No results yet</h3>
              <p>Check the CIG value and try again.</p>
            </div>
          )}

          <div className="results-list">
            {items.map((item, index) => (
              <ResultCard key={`${item.ocid || item.id}-${index}`} item={item} index={index} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (text.includes('"') || text.includes(',') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}
