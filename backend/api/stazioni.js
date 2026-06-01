/**
 * api/stazioni.js — Vercel Serverless Function
 * ─────────────────────────────────────────────
 * Legge da Supabase (già popolato dallo scheduler).
 * Zero parsing CSV — risposta in <200ms.
 *
 * GET /api/stazioni?lat=43.548&lon=10.311&km=10&carb=benzina
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://lemngbvwonmlraakwhdz.supabase.co/rest/v1';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const { lat, lon, km, carb } = req.query;
  const latN = parseFloat(lat);
  const lonN = parseFloat(lon);
  if (isNaN(latN) || isNaN(lonN)) {
    return res.status(400).json({ ok: false, error: 'lat e lon obbligatori' });
  }

  const radiusM  = Math.min((parseFloat(km) || 10) * 1000, 50000);
  const fuelType = ['benzina','gasolio','gpl','metano'].includes(carb) ? carb : 'benzina';

  try {
    // Chiama la funzione PostGIS stations_near() su Supabase
    const url = `${SUPABASE_URL}/rpc/stations_near?` + new URLSearchParams({
      user_lat: latN,
      user_lng: lonN,
      radius_m: radiusM,
      carb:     fuelType,
    });

    const supaRes = await fetch(url, {
      headers: {
        'apikey':        SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      },
    });

    if (!supaRes.ok) {
      const err = await supaRes.text();
      throw new Error(`Supabase: ${err}`);
    }

    const stazioni = await supaRes.json();

    // Prezzi medi nazionali per confronto
    const avgRes = await fetch(`${SUPABASE_URL}/national_averages?select=fuel_type,price`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
    });
    const avgData  = await avgRes.json();
    const prezziMedi = Object.fromEntries((avgData || []).map(r => [r.fuel_type, r.price]));

    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60');
    return res.status(200).json({
      ok:        true,
      totale:    stazioni.length,
      raggio_km: radiusM / 1000,
      carburante: fuelType,
      stazioni,
      prezzi_medi_nazionali: prezziMedi,
      fonte:     'MIMIT Osservaprezzi via Supabase',
    });

  } catch (err) {
    console.error('[stazioni]', err.message);
    return res.status(503).json({
      ok:           false,
      error:        err.message,
      fallback_url: 'https://carburanti.mise.gov.it/ospzSearch/rierca',
    });
  }
}
