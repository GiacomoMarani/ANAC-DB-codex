export function extractItems(data) {
  if (!data) return [];
  if (Array.isArray(data.releases)) return data.releases;
  if (Array.isArray(data.records)) {
    return data.records.map((record) => record.release || record);
  }
  if (Array.isArray(data.results)) return data.results;
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(data)) return data;
  return [];
}

export function extractRelease(data) {
  if (!data) return null;
  if (Array.isArray(data.releases) && data.releases.length) return data.releases[0];
  if (data.release) return data.release;
  if (data.record?.release) return data.record.release;
  if (Array.isArray(data.records) && data.records.length) {
    return data.records[0].release || data.records[0];
  }
  return data;
}

export function normalizeItem(item) {
  if (!item) return {};
  const release = item.release || item;
  const ocid = release.ocid || item.ocid || item.id || '';
  const id = item.id || release.id || ocid;
  const title =
    release.tender?.title ||
    release.contracts?.[0]?.title ||
    release.planning?.project?.title ||
    release.title ||
    id ||
    'Untitled contract';

  const authority =
    release.buyer?.name ||
    release.tender?.procuringEntity?.name ||
    pickPartyByRole(release.parties, ['buyer', 'procuringEntity']) ||
    '';

  const contractor =
    release.awards?.[0]?.suppliers?.[0]?.name ||
    pickPartyByRole(release.parties, ['supplier', 'tenderer', 'contractor']) ||
    '';

  const value = pickValue(release);
  const date = pickDate(release);
  const region = pickRegion(release);

  return {
    id,
    ocid,
    title,
    authority,
    contractor,
    value: value?.amount ?? null,
    currency: value?.currency || '',
    date,
    region
  };
}

function pickPartyByRole(parties, roles) {
  if (!Array.isArray(parties)) return '';
  const match = parties.find((party) =>
    Array.isArray(party.roles) && party.roles.some((role) => roles.includes(role))
  );
  return match?.name || '';
}

function pickValue(release) {
  return (
    release.awards?.[0]?.value ||
    release.contracts?.[0]?.value ||
    release.tender?.value ||
    null
  );
}

function pickDate(release) {
  return (
    release.date ||
    release.contracts?.[0]?.dateSigned ||
    release.awards?.[0]?.date ||
    release.tender?.datePublished ||
    ''
  );
}

function pickRegion(release) {
  const item = release.tender?.items?.[0];
  return (
    item?.deliveryAddress?.region ||
    item?.deliveryAddress?.locality ||
    release.tender?.deliveryAddress?.region ||
    release.tender?.deliveryAddress?.locality ||
    ''
  );
}

export function formatCurrency(amount, currency) {
  if (amount === null || amount === undefined || amount === '') return 'n/a';
  const numeric = Number(amount);
  if (Number.isNaN(numeric)) return String(amount);
  try {
    return new Intl.NumberFormat('it-IT', {
      style: 'currency',
      currency: currency || 'EUR',
      maximumFractionDigits: 0
    }).format(numeric);
  } catch (err) {
    return `${numeric} ${currency || ''}`.trim();
  }
}

export function formatDate(value) {
  if (!value) return 'n/a';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('it-IT');
}
