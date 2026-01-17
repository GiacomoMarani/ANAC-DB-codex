import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import SearchBar from '../components/SearchBar.jsx';

const examples = ['CIG 1234', 'Comune di Roma', 'CPV 45210000', 'servizi sociali'];

export default function Home() {
  const [query, setQuery] = useState('');
  const navigate = useNavigate();

  const handleSubmit = (value) => {
    const next = value.trim();
    if (!next) return;
    navigate(`/search?q=${encodeURIComponent(next)}`);
  };

  return (
    <section className="home">
      <div className="hero">
        <div className="hero-text">
          <h1>Find public contracts fast</h1>
          <p>Search ANAC contract data by authority, contractor, CPV, CIG, or keyword.</p>
        </div>
        <SearchBar
          value={query}
          onChange={setQuery}
          onSubmit={handleSubmit}
          placeholder="Search contracts, authorities, contractors, CPV, CIG"
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
          <h3>Browse by Region</h3>
          <p>Jump into geographic views to spot activity near you.</p>
        </div>
        <div className="quick-card">
          <h3>Browse by Authority</h3>
          <p>See the latest contracts published by each authority.</p>
        </div>
        <div className="quick-card">
          <h3>Explore Trends</h3>
          <p>Visualize changes in value and volume over time.</p>
        </div>
      </div>
    </section>
  );
}
