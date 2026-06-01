/**
 * api/geocode.js
 * Proxy Nominatim OSM — converte città/CAP in coordinate.
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const { q } = req.query;
  if (!q || q.trim().length < 2) {
    return res.status(400).json({ ok: false, error: 'Parametro q obbligatorio' });
  }

  try {
    const url = `https://nominatim.openstreetmap.org/search?` + new URLSearchParams({
      q:               q.trim() + ', Italia',
      format:          'json',
      limit:           1,
      addressdetails:  1,
      countrycodes:    'it',
      'accept-language': 'it',
    });

    const r    = await fetch(url, {
      headers: { 'User-Agent': 'ScintillaPRO/4.0 (https://iltiratore.eu)' },
    });
    const data = await r.json();

    if (!data || data.length === 0) {
      return res.status(404).json({ ok: false, error: `"${q}" non trovato` });
    }

    const addr = data[0].address || {};
    res.setHeader('Cache-Control', 'public, s-maxage=86400');
    return res.status(200).json({
      ok:  true,
      lat: parseFloat(data[0].lat),
      lon: parseFloat(data[0].lon),
      address: {
        city:     addr.city || addr.town || addr.village || '',
        state:    addr.state || '',
        postcode: addr.postcode || '',
      },
    });
  } catch (err) {
    return res.status(503).json({ ok: false, error: err.message });
  }
}
