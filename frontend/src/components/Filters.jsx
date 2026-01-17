import { useEffect, useState } from 'react';

export default function Filters({ values, onApply, onReset }) {
  const [draft, setDraft] = useState(values);

  useEffect(() => {
    setDraft(values);
  }, [values]);

  const handleChange = (field) => (event) => {
    setDraft((prev) => ({ ...prev, [field]: event.target.value }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    onApply(draft);
  };

  return (
    <form className="filters-form" onSubmit={handleSubmit}>
      <div className="filters-header">
        <h3>Filters</h3>
        <button type="button" className="link-button" onClick={onReset}>
          Clear all
        </button>
      </div>

      <label>
        Authority
        <input
          type="text"
          value={draft.authority}
          onChange={handleChange('authority')}
          placeholder="Stazione appaltante"
        />
      </label>

      <label>
        Contractor
        <input
          type="text"
          value={draft.contractor}
          onChange={handleChange('contractor')}
          placeholder="Operatore economico"
        />
      </label>

      <label>
        Amount min
        <input
          type="number"
          value={draft.amount_min}
          onChange={handleChange('amount_min')}
          placeholder="0"
        />
      </label>

      <label>
        Amount max
        <input
          type="number"
          value={draft.amount_max}
          onChange={handleChange('amount_max')}
          placeholder="100000"
        />
      </label>

      <label>
        Date from
        <input type="date" value={draft.date_from} onChange={handleChange('date_from')} />
      </label>

      <label>
        Date to
        <input type="date" value={draft.date_to} onChange={handleChange('date_to')} />
      </label>

      <label>
        Region
        <input
          type="text"
          value={draft.region}
          onChange={handleChange('region')}
          placeholder="Region, province, or city"
        />
      </label>

      <label>
        Contract type
        <select value={draft.contract_type} onChange={handleChange('contract_type')}>
          <option value="">Any type</option>
          <option value="works">Works</option>
          <option value="services">Services</option>
          <option value="supplies">Supplies</option>
        </select>
      </label>

      <label>
        CPV
        <input type="text" value={draft.cpv} onChange={handleChange('cpv')} placeholder="CPV code" />
      </label>

      <button type="submit" className="primary-button">
        Apply filters
      </button>
    </form>
  );
}
