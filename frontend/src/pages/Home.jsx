import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import SearchBar from '../components/SearchBar.jsx';
import { normalizeCigInput } from '../lib/cig.js';

const examples = ['822799329F', '7701655'];

export default function Home() {
  const [query, setQuery] = useState('');
  const navigate = useNavigate();

  const handleSubmit = (value) => {
    const next = normalizeCigInput(value);
    if (!next) return;
    navigate(`/search?cig=${encodeURIComponent(next)}`);
  };

  return (
    <section className="home">
      <div className="hero">
        <div className="hero-text">
          <h1>Find contracts by CIG</h1>
          <p>Insert a CIG to retrieve the contract data from ANAC.</p>
        </div>
        <SearchBar
          value={query}
          onChange={setQuery}
          onSubmit={handleSubmit}
          placeholder="Enter a CIG (e.g. 822799329F)"
          autoFocus
        />
        <div className="examples">
          <span className="examples-label">Examples</span>
          <div className="example-list">
            {examples.map((item) => (
              <button
                key={item}
                type="button"
                className="example-chip"
                onClick={() => handleSubmit(item)}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="quick-paths">
        <div className="quick-card">
          <h3>Search by CIG</h3>
          <p>Paste a CIG code to view all releases for that tender.</p>
        </div>
        <div className="quick-card">
          <h3>Open release detail</h3>
          <p>Explore OCDS fields in a clear, human-readable layout.</p>
        </div>
        <div className="quick-card">
          <h3>Export results</h3>
          <p>Download the releases as CSV for deeper analysis.</p>
        </div>
      </div>
    </section>
  );
}
