/**
 * .github/scripts/update-mimit.js
 * ─────────────────────────────────────────────────────────────
 * Scarica i CSV MIMIT ufficiali e aggiorna Supabase.
 * Gira ogni mattina alle 08:30 IT via GitHub Actions.
 *
 * CSV MIMIT (separatore | dal 10/02/2026):
 *   Prezzi medi:  https://www.mise.gov.it/images/exportCSV/prezzo_alle_8.csv
 *   Anagrafica:   https://www.mise.gov.it/images/exportCSV/anagrafica_impianti_attivi.csv
 *   Prezzi impl.: https://www.mise.gov.it/images/exportCSV/prezzi_al_pubblico_attuale.csv
 * ─────────────────────────────────────────────────────────────
 */

const SUPABASE_URL     = process.env.SUPABASE_URL;
const SUPABASE_KEY     = process.env.SUPABASE_SERVICE_KEY;
const SUPABASE_REST    = SUPABASE_URL.replace('/rest/v1/', '') + '/rest/v1';

const MIMIT = {
  prezziMedi: 'https://www.mise.gov.it/images/exportCSV/prezzo_alle_8.csv',
  anagrafica:  'https://www.mise.gov.it/images/exportCSV/anagrafica_impianti_attivi.csv',
  prezziImpl:  'https://www.mise.gov.it/images/exportCSV/prezzi_al_pubblico_attuale.csv',
};

const HEADERS_MIMIT = {
  'User-Agent': 'ScintillaPRO/4.0 (data-gel.eu; ricerca pubblica carburanti Italia)',
  'Accept': 'text/csv, text/plain, */*',
};

const HEADERS_SUPABASE = {
  'apikey':        SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type':  'application/json',
  'Prefer':        'resolution=merge-duplicates',
};

// Rileva separatore automaticamente (| dal 10/02/2026, ; prima)
function parseLine(line) {
  const sep = line.includes('|') ? '|' : ';';
  return line.split(sep).map(c => c.replace(/"/g, '').trim());
}

// Supabase upsert a blocchi
async function upsert(table, rows, batchSize = 500) {
  if (rows.length === 0) return;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const res = await fetch(`${SUPABASE_REST}/${table}`, {
      method:  'POST',
      headers: { ...HEADERS_SUPABASE, 'Prefer': 'resolution=merge-duplicates' },
      body:    JSON.stringify(batch),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Supabase upsert ${table} batch ${i}: ${err}`);
    }
    inserted += batch.length;
    process.stdout.write(`\r  ${table}: ${inserted}/${rows.length} righe...`);
  }
  console.log(`\r  ✅ ${table}: ${inserted} righe aggiornate`);
}

// ── STEP 1: Prezzi medi nazionali ───────────────────────────────
async function updateNationalAverages() {
  console.log('\n📊 Aggiornamento prezzi medi nazionali...');
  const res  = await fetch(MIMIT.prezziMedi, { headers: HEADERS_MIMIT });
  if (!res.ok) throw new Error(`MIMIT prezzi medi HTTP ${res.status}`);
  const text = await res.text();

  const averages = [];
  for (const line of text.split('\n')) {
    const l = line.trim();
    if (!l || l.toLowerCase().startsWith('desc')) continue;
    const cols = parseLine(l);
    if (cols.length < 3) continue;

    const desc   = cols[0].toLowerCase();
    const pSelf  = parseFloat((cols[1] || '').replace(',', '.'));
    const pServ  = parseFloat((cols[2] || '').replace(',', '.'));

    if (isNaN(pSelf) || pSelf <= 0) continue;

    if (desc.includes('benzina') && !desc.includes('risc')) {
      averages.push({ fuel_type: 'benzina_self',    price: pSelf, updated_at: new Date().toISOString() });
      if (!isNaN(pServ)) averages.push({ fuel_type: 'benzina_servito', price: pServ, updated_at: new Date().toISOString() });
    } else if (desc.includes('gasolio') && desc.includes('risc')) {
      averages.push({ fuel_type: 'gasolio_riscaldamento', price: pSelf, updated_at: new Date().toISOString() });
    } else if (desc.includes('gasolio')) {
      averages.push({ fuel_type: 'gasolio_self',    price: pSelf, updated_at: new Date().toISOString() });
      if (!isNaN(pServ)) averages.push({ fuel_type: 'gasolio_servito', price: pServ, updated_at: new Date().toISOString() });
    } else if (desc.includes('gpl')) {
      averages.push({ fuel_type: 'gpl',             price: pSelf, updated_at: new Date().toISOString() });
    } else if (desc.includes('metano') || desc.includes('gnc') || desc.includes('cng')) {
      averages.push({ fuel_type: 'metano',          price: pSelf, updated_at: new Date().toISOString() });
    }
  }

  if (averages.length === 0) throw new Error('Nessun prezzo medio trovato nel CSV');
  await upsert('national_averages', averages, 20);
  console.log(`  Prezzi trovati: ${averages.map(a => `${a.fuel_type}=€${a.price}`).join(' | ')}`);
}

// ── STEP 2: Anagrafica stazioni ──────────────────────────────────
async function updateStations() {
  console.log('\n🏪 Download anagrafica stazioni MIMIT...');
  const res  = await fetch(MIMIT.anagrafica, { headers: HEADERS_MIMIT });
  if (!res.ok) throw new Error(`MIMIT anagrafica HTTP ${res.status}`);
  const text = await res.text();
  const lines = text.split('\n');
  console.log(`  Righe CSV: ${lines.length}`);

  const stations = [];
  for (const line of lines) {
    const l = line.trim();
    if (!l || l.toLowerCase().startsWith('id')) continue;

    // Formato: idImpianto|gestore|Bandiera|TipoImpianto|NomeImpianto|Indirizzo|Comune|Provincia|Latitudine|Longitudine
    const c = parseLine(l);
    if (c.length < 10) continue;

    const lat = parseFloat(c[8].replace(',', '.'));
    const lng = parseFloat(c[9].replace(',', '.'));

    // Valida coordinate Italia
    if (isNaN(lat) || isNaN(lng)) continue;
    if (lat < 35.5 || lat > 47.1 || lng < 6.6 || lng > 18.6) continue;

    stations.push({
      id:        c[0],
      gestore:   c[1] || '',
      brand:     c[2] || c[1] || '',
      tipo:      c[3] || '',
      nome:      c[4] || c[2] || c[1] || 'Stazione carburante',
      indirizzo: c[5] || '',
      comune:    c[6] || '',
      provincia: c[7] || '',
      lat,
      lng,
      updated_at: new Date().toISOString(),
    });
  }

  console.log(`  Stazioni valide: ${stations.length}`);
  await upsert('stations', stations, 500);
}

// ── STEP 3: Prezzi per impianto ──────────────────────────────────
async function updateFuelPrices() {
  console.log('\n⛽ Download prezzi impianti MIMIT...');
  const res  = await fetch(MIMIT.prezziImpl, { headers: HEADERS_MIMIT });
  if (!res.ok) throw new Error(`MIMIT prezzi impianti HTTP ${res.status}`);
  const text = await res.text();
  const lines = text.split('\n');
  console.log(`  Righe CSV: ${lines.length}`);

  // Prima: svuota prezzi vecchi (vengono sostituiti completamente ogni giorno)
  console.log('  Pulizia prezzi precedenti...');
  const delRes = await fetch(`${SUPABASE_REST}/fuel_prices?updated_at=lt.${new Date(Date.now() - 86400000).toISOString()}`, {
    method:  'DELETE',
    headers: HEADERS_SUPABASE,
  });
  if (!delRes.ok) console.warn('  ⚠️ Pulizia prezzi non riuscita — continuo comunque');

  const prices = [];
  const fuelMap = {
    'benzina': 'benzina', 'benzina senza piombo': 'benzina',
    'gasolio': 'gasolio', 'gasolio auto': 'gasolio',
    'gpl': 'gpl', 'g.p.l.': 'gpl', 'gpl auto': 'gpl',
    'metano': 'metano', 'gnc': 'metano', 'cng': 'metano',
    'metano auto': 'metano',
  };

  for (const line of lines) {
    const l = line.trim();
    if (!l || l.toLowerCase().startsWith('id')) continue;

    // Formato: idImpianto|descCarburante|prezzo|isSelf|dtComu
    const c = parseLine(l);
    if (c.length < 4) continue;

    const stationId  = c[0];
    const fuelRaw    = (c[1] || '').toLowerCase().trim();
    const price      = parseFloat((c[2] || '').replace(',', '.'));
    const isSelf     = c[3] === '1' || c[3].toLowerCase() === 'true';
    const fuelType   = fuelMap[fuelRaw];

    if (!stationId || !fuelType || isNaN(price) || price <= 0) continue;
    if (price < 0.3 || price > 5.0) continue; // sanity check

    prices.push({
      station_id: stationId,
      fuel_type:  fuelType,
      is_self:    isSelf,
      price,
      updated_at: new Date().toISOString(),
    });
  }

  console.log(`  Prezzi validi: ${prices.length}`);
  await upsert('fuel_prices', prices, 500);

  // Salva snapshot in price_history (per storico)
  const snapshot = prices.map(p => ({
    station_id:  p.station_id,
    fuel_type:   p.fuel_type,
    is_self:     p.is_self,
    price:       p.price,
    recorded_at: new Date().toISOString(),
  }));
  console.log('  Salvataggio storico prezzi...');
  await upsert('price_history', snapshot.slice(0, 10000), 500); // max 10k per il piano free
}

// ── MAIN ─────────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  SCINTILLA PRO — Aggiornamento MIMIT → Supabase');
  console.log(`  ${new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}`);
  console.log('═══════════════════════════════════════════════');

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('SUPABASE_URL e SUPABASE_SERVICE_KEY devono essere configurati nei GitHub Secrets');
  }

  const t = Date.now();

  await updateNationalAverages();
  await updateStations();
  await updateFuelPrices();

  const elapsed = ((Date.now() - t) / 1000).toFixed(1);
  console.log(`\n✅ Completato in ${elapsed}s`);
  console.log('═══════════════════════════════════════════════\n');
}

main().catch(err => {
  console.error('\n❌ ERRORE:', err.message);
  process.exit(1);
});
