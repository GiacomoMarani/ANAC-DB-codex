import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import Home from './pages/Home.jsx';
import Results from './pages/Results.jsx';
import Contract from './pages/Contract.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <header className="site-header">
          <div className="brand">
            <Link to="/">ANAC Contract Explorer</Link>
            <span className="brand-tag">Public contracts, made easy</span>
          </div>
          <nav className="site-nav">
            <Link to="/search">Search</Link>
            <a
              href="https://dati.anticorruzione.it/opendata/ocds/api/ui"
              target="_blank"
              rel="noreferrer"
            >
              API UI
            </a>
          </nav>
        </header>
        <main className="site-main">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/search" element={<Results />} />
            <Route path="/contract/:ocid" element={<Contract />} />
          </Routes>
        </main>
        <footer className="site-footer">
          <span>Prototype scaffold for ANAC OCDS exploration.</span>
        </footer>
      </div>
    </BrowserRouter>
  );
}
