export default function SearchBar({ value, onChange, onSubmit, placeholder, autoFocus }) {
  const handleSubmit = (event) => {
    event.preventDefault();
    onSubmit(value);
  };

  return (
    <form className="search-bar" onSubmit={handleSubmit}>
      <input
        className="search-input"
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
      />
      <button className="search-button" type="submit">
        Search
      </button>
    </form>
  );
}
