/**
 * api/prezzi-medi.js
 * Legge i prezzi medi nazionali da Supabase (aggiornati ogni mattina).
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://lemngbvwonmlraakwhdz.supabase.co/rest/v1';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const supaRes = await fetch(
      `${SUPABASE_URL}/national_averages?select=fuel_type,price,updated_at`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );

    if (!supaRes.ok) throw new Error(`Supabase HTTP ${supaRes.status}`);
    const rows = await supaRes.json();

    const data = {};
    let updated_at = null;
    for (const r of rows) {
      data[r.fuel_type] = r.price;
      if (!updated_at) updated_at = r.updated_at;
    }

    if (Object.keys(data).length === 0) throw new Error('Nessun dato in national_averages — scheduler non ancora eseguito?');

    res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=300');
    return res.status(200).json({
      ok:   true,
      data: { ...data, updated_at, fonte: 'MIMIT Osservaprezzi via Supabase' },
    });

  } catch (err) {
    return res.status(503).json({ ok: false, error: err.message });
  }
}
