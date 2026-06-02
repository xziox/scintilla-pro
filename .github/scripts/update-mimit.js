const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SUPABASE_REST = SUPABASE_URL.replace(/\/+$/, '');
const MIMIT_URL = 'https://www.mise.gov.it/images/exportCSV/prezzo_alle_8.csv';
const MIMIT_ANA = 'https://www.mise.gov.it/images/exportCSV/anagrafica_impianti_attivi.csv';
const HEADERS_MIMIT = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };
const HEADERS_SB = { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json' };

// Capoluoghi delle 20 regioni italiane
const REGIONI = [
  { name: 'Torino',          lat: 45.07, lon: 7.69  },
  { name: 'Milano',          lat: 45.46, lon: 9.19  },
  { name: 'Venezia',         lat: 45.44, lon: 12.33 },
  { name: 'Trieste',         lat: 45.65, lon: 13.77 },
  { name: 'Genova',          lat: 44.41, lon: 8.93  },
  { name: 'Bologna',         lat: 44.49, lon: 11.34 },
  { name: 'Firenze',         lat: 43.77, lon: 11.25 },
  { name: 'Perugia',         lat: 43.11, lon: 12.39 },
  { name: 'Ancona',          lat: 43.61, lon: 13.51 },
  { name: 'Roma',            lat: 41.89, lon: 12.49 },
  { name: 'LAquila',         lat: 42.35, lon: 13.40 },
  { name: 'Campobasso',      lat: 41.56, lon: 14.66 },
  { name: 'Napoli',          lat: 40.84, lon: 14.25 },
  { name: 'Potenza',         lat: 40.64, lon: 15.80 },
  { name: 'Catanzaro',       lat: 38.91, lon: 16.59 },
  { name: 'Bari',            lat: 41.12, lon: 16.87 },
  { name: 'Palermo',         lat: 38.11, lon: 13.35 },
  { name: 'Catania',         lat: 37.50, lon: 15.09 },
  { name: 'Cagliari',        lat: 39.22, lon: 9.11  },
  { name: 'Trento',          lat: 46.07, lon: 11.12 },
];

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

async function overpassQuery(lat, lon, radius) {
  const query = '[out:json][timeout:12];node["shop"~"doityourself|hardware|garden_centre"](around:' + radius + ',' + lat + ',' + lon + ');out tags;';
  const r = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
      'User-Agent': 'ScintillaPRO/4.0 (https://iltiratore.eu; negozi combustibili Italia)'
    },
    body: 'data=' + encodeURIComponent(query)
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return await r.json();
}

async function updateStores() {
  console.log('\n🏪 Download negozi combustibili per regione...');
  const allStores = new Map();
  let totFound = 0;

  for (const regione of REGIONI) {
    try {
      const data = await overpassQuery(regione.lat, regione.lon, 100000);
      const elements = data.elements || [];
      totFound += elements.length;
      process.stdout.write('\r  ' + regione.name + ': ' + elements.length + ' — tot: ' + totFound + '    ');
      for (const el of elements) {
        const tags = el.tags || {};
        const nome = tags.name || '';
        if (!nome || !el.lat || !el.lon) continue;
        if (el.lat < 35.5 || el.lat > 47.1 || el.lon < 6.6 || el.lon > 18.6) continue;
        allStores.set(String(el.id), {
          id:        String(el.id),
          nome:      nome,
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
      process.stdout.write('\r  ' + regione.name + ': errore ' + e.message + '\n');
    }
    await new Promise(r => setTimeout(r, 1500));
  }

  console.log('\n  Totale negozi unici: ' + allStores.size);
  const stores = Array.from(allStores.values());
  if (stores.length > 0) {
    await upsert('stores', stores, 500);
  }
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
    const lat = parseFloat(c[8].replace(',', '.'));
    const lng = parseFloat(c[9].replace(',', '.'));
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

main().catch(function(err) { console.error('\n❌ ERRORE: ' + err.message); process.exit(1); });