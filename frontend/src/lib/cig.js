export function normalizeCigInput(value) {
  if (!value) return '';
  const trimmed = value.trim();
  const withoutPrefix = trimmed.replace(/^CIG\s*/i, '');
  return withoutPrefix.replace(/\s+/g, '');
}
