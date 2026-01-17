import { Link } from 'react-router-dom';
import { formatCurrency, formatDate } from '../lib/normalize.js';

export default function ResultCard({ item, index }) {
  const detailPath = item.ocid ? `/contract/${encodeURIComponent(item.ocid)}` : null;
  const hasValue = item.value !== null && item.value !== undefined && item.value !== '';
  const content = (
    <>
      <h3>{item.title || 'Untitled contract'}</h3>
      <div className="meta">
        <span>{item.authority || 'Unknown authority'}</span>
        <span>{item.contractor || 'Unknown contractor'}</span>
        <span>{item.date ? formatDate(item.date) : 'Date n/a'}</span>
        <span>{item.region || 'Region n/a'}</span>
      </div>
      <div className="value">
        {hasValue ? formatCurrency(item.value, item.currency || 'EUR') : 'Value n/a'}
      </div>
      <div className="ocid">OCID: {item.ocid || 'n/a'}</div>
    </>
  );

  return (
    <div className="result-card" style={{ '--delay': `${index * 30}ms` }}>
      {detailPath ? (
        <Link to={detailPath} className="result-link">
          {content}
        </Link>
      ) : (
        <div className="result-link disabled">{content}</div>
      )}
    </div>
  );
}
