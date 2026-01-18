export function extractItems(data) {
  if (!data) return [];
  if (isSmartCig(data)) return [data];
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
  if (Array.isArray(data) && data.length) return data[0];
  if (Array.isArray(data.releases) && data.releases.length) return data.releases[0];
  if (data.release) return data.release;
  if (data.record?.release) return data.record.release;
  if (Array.isArray(data.records) && data.records.length) {
    return data.records[0].release || data.records[0];
  }
  if (isSmartCig(data)) return data;
  return data;
}

export function normalizeItem(item) {
  if (!item) return {};
  if (isSmartCig(item)) {
    return normalizeSmartCig(item);
  }
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

  const cig =
    release.tender?.id ||
    release.tender?.items?.[0]?.id ||
    release.tender?.items?.[0]?.relatedLot ||
    release.awards?.[0]?.relatedLot ||
    release.awards?.[0]?.relatedLots?.[0] ||
    '';

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
    cig,
    title,
    authority,
    contractor,
    value: value?.amount ?? null,
    currency: value?.currency || '',
    date,
    region,
    source: 'ocds'
  };
}

function isSmartCig(item) {
  return Boolean(
    item &&
      (item.CIG ||
        item.cig ||
        item.OGGETTO_GARA ||
        item.oggetto_gara ||
        item.IMPORTO_COMPLESSIVO_GARA ||
        item.importo_complessivo_gara)
  );
}

function normalizeSmartCig(item) {
  const cig = pickSmartField(item, ['CIG', 'cig', 'CODICE_CIG', 'codice_cig']);
  const title = pickSmartField(item, ['OGGETTO_GARA', 'oggetto_gara', 'OGGETTO', 'oggetto']);
  const authority =
    pickSmartAuthority(item) ||
    pickSmartField(item, [
      'DENOMINAZIONE_AMMINISTRAZIONE_APPALTANTE',
      'denominazione_amministrazione_appaltante'
    ]) ||
    '';
  const contractor = pickSmartField(item, [
    'AGGIUDICATARIO',
    'aggiudicatario',
    'DENOMINAZIONE_AGGIUDICATARIO',
    'denominazione_aggiudicatario'
  ]);
  const amountRaw = pickSmartField(item, [
    'IMPORTO_COMPLESSIVO_GARA',
    'importo_complessivo_gara',
    'IMPORTO_GARA',
    'importo_gara',
    'IMPORTO',
    'importo'
  ]);
  const value = parseAmount(amountRaw);
  const currency = pickSmartField(item, ['VALUTA', 'valuta']) || 'EUR';
  const date = pickSmartField(item, [
    'DATA_PUBBLICAZIONE',
    'data_pubblicazione',
    'DATA_PUBBLICAZIONE_BANDO',
    'data_pubblicazione_bando',
    'DATA',
    'data'
  ]);

  return {
    id: cig || '',
    ocid: '',
    cig: cig || '',
    title: title || 'CIG detail',
    authority,
    contractor: contractor || '',
    value,
    currency,
    date,
    region: '',
    source: 'smartcig'
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

function pickSmartAuthority(item) {
  const station = item.STAZIONE_APPALTANTE || item.stazione_appaltante;
  if (!station) return '';
  if (typeof station === 'string') return station;
  return (
    pickSmartField(station, [
      'DENOMINAZIONE',
      'denominazione',
      'NOME',
      'nome',
      'DENOMINAZIONE_AMMINISTRAZIONE_APPALTANTE',
      'denominazione_amministrazione_appaltante'
    ]) || ''
  );
}

function pickSmartField(source, keys) {
  if (!source) return '';
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== '') {
      return String(source[key]);
    }
  }
  return '';
}

function parseAmount(value) {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value).trim();
  const normalized = text
    .replace(/\./g, '')
    .replace(/,/g, '.')
    .replace(/[^0-9.-]/g, '');
  const numeric = Number(normalized);
  return Number.isNaN(numeric) ? null : numeric;
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
