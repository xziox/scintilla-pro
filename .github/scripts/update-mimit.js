const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SUPABASE_REST = SUPABASE_URL.replace(/\/+$/, '');
const MIMIT_URL = 'https://www.mise.gov.it/images/exportCSV/prezzo_alle_8.csv';
const MIMIT_ANA = 'https://www.mise.gov.it/images/exportCSV/anagrafica_impianti_attivi.csv';const HEADERS_MIMIT = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };
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

  console.log('\n⬇️  Download anagrafica stazioni...');
const resAna = await fetch(MIMIT_ANA, { headers: HEADERS_MIMIT });
if (!resAna.ok) throw new Error('MIMIT anagrafica HTTP ' + resAna.status);
const textAna = await resAna.text();
const linesAna = textAna.split('\n');
console.log('  Righe anagrafica: ' + linesAna.length);
const stationsArr = [];
for (const line of linesAna) {
  const l = line.trim();
  if (!l || l.startsWith('Estrazione') || l.toLowerCase().startsWith('id')) continue;
  const c = parseLine(l);
  if (c.length < 10) continue;
  const lat = parseFloat(c[8].replace(',','.'));
  const lng = parseFloat(c[9].replace(',','.'));
  if (isNaN(lat) || isNaN(lng)) continue;
  if (lat < 35.5 || lat > 47.1 || lng < 6.6 || lng > 18.6) continue;
  stationsArr.push({ id: c[0], gestore: c[1]||'', brand: c[2]||c[1]||'', tipo: c[3]||'', nome: c[4]||c[2]||'Stazione', indirizzo: c[5]||'', comune: c[6]||'', provincia: c[7]||'', lat: lat, lng: lng, updated_at: new Date().toISOString() });
}
console.log('  Stazioni valide: ' + stationsArr.length);

console.log('\n💾 Salvataggio su Supabase...');
  await fetch(SUPABASE_REST + '/national_averages?fuel_type=neq.null', { method: 'DELETE', headers: HEADERS_SB });
  await upsert('national_averages', averages, 20);
  await upsert('stations', stationsArr, 500);
  await upsert('fuel_prices', prices, 500);
  await updateStores();
  console.log('\n✅ Completato!');
}
async function updateStores() {
  console.log('\n🏪 Download negozi combustibili da Overpass...');
  
  // Interroga tutta Italia divisa in 3 zone per non sovraccaricare Overpass
  const zones = [
    { name: 'Nord', lat: 45.5, lon: 10.0 },
    { name: 'Centro', lat: 43.0, lon: 12.0 },
    { name: 'Sud', lat: 40.5, lon: 16.0 },
  ];

  const allStores = new Map();

  for (const zone of zones) {
    console.log(`  Zona ${zone.name}...`);
    const query = `
      [out:json][timeout:30];
      (
        node["shop"~"doityourself|hardware|garden_centre|fuel"](around:400000,${zone.lat},${zone.lon});
        node["name"~"Agri|Consorzio|Cooperat|Brico|OBI|Leroy|Pellet|Legna|Biomass|Cippato|Segheria",i](around:400000,${zone.lat},${zone.lon});
      );
      out tags;
    `;
    try {
      const r = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
       headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json', 'User-Agent': 'ScintillaPRO/4.0 (https://iltiratore.eu; aggiornamento notturno negozi combustibili Italia)' },
        body: 'data=' + encodeURIComponent(query)
      });
      if (!r.ok) { console.warn(`  Overpass ${zone.name}: HTTP ${r.status}`); continue; }
      const data = await r.json();
      const elements = data.elements || [];
      console.log(`  ${zone.name}: ${elements.length} elementi`);
      for (const el of elements) {
        const tags = el.tags || {};
        const nome = tags.name || '';
        if (!nome || !el.lat || !el.lon) continue;
        if (el.lat < 35.5 || el.lat > 47.1 || el.lon < 6.6 || el.lon > 18.6) continue;
        allStores.set(String(el.id), {
          id:        String(el.id),
          nome,
          tipo:      tags.shop || tags.amenity || 'negozio',
          shop:      tags.shop || '',
          indirizzo: [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' '),
          comune:    tags['addr:city'] || tags['addr:town'] || tags['addr:village'] || '',
          provincia: tags['addr:province'] || tags['addr:county'] || '',
          lat:       el.lat,
          lng:       el.lon,
          telefono:  tags.phone || tags['contact:phone'] || '',
          website:   tags.website || tags['contact:website'] || '',
          orari:     tags.opening_hours || '',
          updated_at: new Date().toISOString()
        });
      }
    } catch(e) {
      console.warn(`  Overpass ${zone.name} errore:`, e.message);
    }
    await new Promise(r => setTimeout(r, 3000)); // pausa 3s tra le zone
  }

  const stores = Array.from(allStores.values());
  console.log(`  Totale negozi unici: ${stores.length}`);
  if (stores.length > 0) {
    await upsert('stores', stores, 500);
  }
}
main().catch(function(err) { console.error('\n❌ ERRORE: ' + err.message); process.exit(1); });
