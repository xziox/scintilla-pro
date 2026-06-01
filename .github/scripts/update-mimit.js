const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SUPABASE_REST = SUPABASE_URL.replace(/\/+$/, '');
const MIMIT_URL = 'https://www.mise.gov.it/images/exportCSV/prezzo_alle_8.csv';
const HEADERS_MIMIT = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };
const HEADERS_SB = { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json' };

function parseLine(line) {
  const sep = line.includes('|') ? '|' : ';';
  return line.split(sep).map(c => c.replace(/"/g, '').trim());
}

async function upsert(table, rows, batchSize) {
  batchSize = batchSize || 500;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const res = await fetch(SUPABASE_REST + '/' + table, {
      method: 'POST',
      headers: Object.assign({}, HEADERS_SB, { 'Prefer': 'resolution=merge-duplicates' }),
      body: JSON.stringify(batch)
    });
    if (!res.ok) { const e = await res.text(); throw new Error('Supabase ' + table + ': ' + e); }
    process.stdout.write('\r  ' + table + ': ' + (i + batch.length) + '/' + rows.length);
  }
  console.log('');
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  SCINTILLA PRO — Aggiornamento MIMIT → Supabase');
  console.log('  ' + new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' }));
  console.log('═══════════════════════════════════════════════');

  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('SUPABASE_URL e SUPABASE_SERVICE_KEY devono essere configurati nei GitHub Secrets');

  console.log('\n⬇️  Download CSV MIMIT...');
  const res = await fetch(MIMIT_URL, { headers: HEADERS_MIMIT });
  if (!res.ok) throw new Error('MIMIT HTTP ' + res.status);
  const text = await res.text();
  const lines = text.split('\n');
  console.log('  Righe CSV: ' + lines.length);

  const fuelMap = { 'benzina': 'benzina', 'gasolio': 'gasolio', 'gpl': 'gpl', 'g.p.l.': 'gpl', 'metano': 'metano', 'gnc': 'metano', 'cng': 'metano' };
  const stations = {};
  const prices = [];
  const totals = {};
  const counts = {};

  for (const line of lines) {
    const l = line.trim();
    if (!l || l.startsWith('Estrazione') || l.toLowerCase().startsWith('id')) continue;
    const c = parseLine(l);
    if (c.length < 4) continue;
    const stationId = c[0];
    const fuelRaw = (c[1] || '').toLowerCase().trim();
    const price = parseFloat((c[2] || '').replace(',', '.'));
    const isSelf = c[3] === '1';
    const fuelType = fuelMap[fuelRaw];
    if (!stationId || !fuelType || isNaN(price) || price < 0.3 || price > 5.0) continue;
    prices.push({ station_id: stationId, fuel_type: fuelType, is_self: isSelf, price: price, updated_at: new Date().toISOString() });
    const key = fuelType + (isSelf ? '_self' : '_servito');
    if (!totals[key]) { totals[key] = 0; counts[key] = 0; }
    totals[key] += price;
    counts[key]++;
  }

  console.log('  Prezzi validi: ' + prices.length);

  const averages = Object.keys(totals).map(function(k) {
    return { fuel_type: k, price: Math.round(totals[k] / counts[k] * 1000) / 1000, updated_at: new Date().toISOString() };
  });

  console.log('\n📊 Medie calcolate:');
  averages.forEach(function(a) { console.log('  ' + a.fuel_type + ': ' + a.price); });

  console.log('\n💾 Salvataggio su Supabase...');
  await upsert('national_averages', averages, 20);
  await upsert('fuel_prices', prices, 500);

  console.log('\n✅ Completato!');
}

main().catch(function(err) { console.error('\n❌ ERRORE: ' + err.message); process.exit(1); });
