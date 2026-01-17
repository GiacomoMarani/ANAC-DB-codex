import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import SearchBar from '../components/SearchBar.jsx';
import Filters from '../components/Filters.jsx';
import ResultCard from '../components/ResultCard.jsx';
import { extractItems, normalizeItem, formatCurrency } from '../lib/normalize.js';
import { getApiBase } from '../lib/api.js';

export default function Results() {
  const apiBase = getApiBase();
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get('q') || '';
  const [query, setQuery] = useState(q);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const hasParams = Array.from(searchParams.keys()).length > 0;

  useEffect(() => {
    setQuery(q);
  }, [q]);

  useEffect(() => {
    if (!hasParams) return;

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
  }, [searchParams]);

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

  const updateParams = (updates) => {
    const next = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') {
        next.delete(key);
      } else {
        next.set(key, String(value));
      }
    });
    setSearchParams(next, { replace: true });
  };

  const handleSubmit = (value) => {
    const next = value.trim();
    if (!next) return;
    updateParams({ q: next, page: '1' });
  };

  const handleApplyFilters = (filters) => {
    updateParams({ ...filters, page: '1' });
  };

  const handleResetFilters = () => {
    const next = new URLSearchParams();
    if (q) {
      next.set('q', q);
    }
    setSearchParams(next, { replace: true });
  };

  const handleExport = () => {
    if (!items.length) return;
    const header = ['ocid', 'title', 'authority', 'contractor', 'value', 'currency', 'date', 'region'];
    const rows = items.map((item) => [
      item.ocid || '',
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

  const currentFilters = useMemo(
    () => ({
      authority: searchParams.get('authority') || '',
      contractor: searchParams.get('contractor') || '',
      amount_min: searchParams.get('amount_min') || '',
      amount_max: searchParams.get('amount_max') || '',
      date_from: searchParams.get('date_from') || '',
      date_to: searchParams.get('date_to') || '',
      region: searchParams.get('region') || '',
      contract_type: searchParams.get('contract_type') || '',
      cpv: searchParams.get('cpv') || ''
    }),
    [searchParams]
  );

  return (
    <section className="results-page">
      <div className="results-top">
        <SearchBar
          value={query}
          onChange={setQuery}
          onSubmit={handleSubmit}
          placeholder="Search contracts, authorities, contractors, CPV, CIG"
        />
        <div className="results-actions">
          <button type="button" className="ghost-button" onClick={handleExport}>
            Export CSV
          </button>
        </div>
      </div>

      <div className="results-layout">
        <aside className="filters">
          <Filters values={currentFilters} onApply={handleApplyFilters} onReset={handleResetFilters} />
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
          {!hasParams && (
            <div className="empty-state">
              <h3>Start with a search</h3>
              <p>Type a keyword, authority, contractor, CPV, or CIG to begin.</p>
            </div>
          )}

          {hasParams && !loading && !error && !items.length && (
            <div className="empty-state">
              <h3>No results yet</h3>
              <p>Try a different query or remove some filters.</p>
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
