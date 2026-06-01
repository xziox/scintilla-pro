-- ═══════════════════════════════════════════════════════════════
-- SCINTILLA PRO — Schema Database Supabase
-- Esegui questo SQL nel SQL Editor di Supabase
-- ═══════════════════════════════════════════════════════════════

-- Abilita PostGIS per geolocalizzazione
CREATE EXTENSION IF NOT EXISTS postgis;

-- ── STAZIONI ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stations (
  id            TEXT PRIMARY KEY,       -- id impianto MIMIT
  nome          TEXT,
  brand         TEXT,
  gestore       TEXT,
  tipo          TEXT,
  indirizzo     TEXT,
  comune        TEXT,
  provincia     TEXT,
  lat           DOUBLE PRECISION,
  lng           DOUBLE PRECISION,
  location      GEOGRAPHY(POINT, 4326), -- colonna PostGIS per query geografiche veloci
  self          BOOLEAN DEFAULT true,
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Indice geografico — rende la ricerca per raggio istantanea
CREATE INDEX IF NOT EXISTS stations_location_idx
  ON stations USING GIST (location);

-- Indice provincia per filtri regionali
CREATE INDEX IF NOT EXISTS stations_provincia_idx
  ON stations (provincia);

-- ── PREZZI CARBURANTI ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fuel_prices (
  id            BIGSERIAL PRIMARY KEY,
  station_id    TEXT REFERENCES stations(id) ON DELETE CASCADE,
  fuel_type     TEXT,    -- benzina | gasolio | gpl | metano
  is_self       BOOLEAN,
  price         NUMERIC(6,3),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Indice per query veloci stazione+carburante
CREATE INDEX IF NOT EXISTS fuel_prices_station_idx
  ON fuel_prices (station_id, fuel_type, is_self);

-- Indice per trovare prezzi recenti
CREATE INDEX IF NOT EXISTS fuel_prices_updated_idx
  ON fuel_prices (updated_at DESC);

-- ── STORICO PREZZI ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS price_history (
  id            BIGSERIAL PRIMARY KEY,
  station_id    TEXT,
  fuel_type     TEXT,
  is_self       BOOLEAN,
  price         NUMERIC(6,3),
  recorded_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS price_history_station_idx
  ON price_history (station_id, fuel_type, recorded_at DESC);

-- ── PREZZI MEDI NAZIONALI ────────────────────────────────────────
-- Tabella piccola — aggiornata ogni mattina dallo scheduler
CREATE TABLE IF NOT EXISTS national_averages (
  id            BIGSERIAL PRIMARY KEY,
  fuel_type     TEXT UNIQUE,   -- benzina_self | gasolio_self | gpl | metano
  price         NUMERIC(6,3),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Dati iniziali (verranno sovrascritti dallo scheduler)
INSERT INTO national_averages (fuel_type, price) VALUES
  ('benzina_self',    1.762),
  ('benzina_servito', 1.886),
  ('gasolio_self',    1.618),
  ('gasolio_servito', 1.744),
  ('gpl',             0.714),
  ('metano',          1.485),
  ('gasolio_riscaldamento', 1.240)
ON CONFLICT (fuel_type) DO NOTHING;

-- ── FUNZIONE RICERCA PER RAGGIO ──────────────────────────────────
-- Chiama questa funzione dall'API:
-- SELECT * FROM stations_near(43.548, 10.311, 10000, 'benzina')
CREATE OR REPLACE FUNCTION stations_near(
  user_lat    DOUBLE PRECISION,
  user_lng    DOUBLE PRECISION,
  radius_m    INTEGER,          -- raggio in metri
  carb        TEXT DEFAULT 'benzina'
)
RETURNS TABLE (
  id          TEXT,
  nome        TEXT,
  brand       TEXT,
  indirizzo   TEXT,
  comune      TEXT,
  provincia   TEXT,
  lat         DOUBLE PRECISION,
  lng         DOUBLE PRECISION,
  dist_m      DOUBLE PRECISION,
  price_self  NUMERIC,
  price_serv  NUMERIC,
  updated_at  TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.id,
    s.nome,
    s.brand,
    s.indirizzo,
    s.comune,
    s.provincia,
    s.lat,
    s.lng,
    ST_Distance(s.location, ST_MakePoint(user_lng, user_lat)::geography) AS dist_m,
    MAX(CASE WHEN fp.is_self = true  THEN fp.price END) AS price_self,
    MAX(CASE WHEN fp.is_self = false THEN fp.price END) AS price_serv,
    MAX(fp.updated_at) AS updated_at
  FROM stations s
  LEFT JOIN fuel_prices fp
    ON fp.station_id = s.id
    AND fp.fuel_type = carb
  WHERE ST_DWithin(
    s.location,
    ST_MakePoint(user_lng, user_lat)::geography,
    radius_m
  )
  GROUP BY s.id, s.nome, s.brand, s.indirizzo, s.comune, s.provincia, s.lat, s.lng, s.location
  ORDER BY dist_m ASC
  LIMIT 50;
END;
$$ LANGUAGE plpgsql;

-- ── ROW LEVEL SECURITY ───────────────────────────────────────────
-- Lettura pubblica — chiunque può leggere prezzi e stazioni
ALTER TABLE stations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE fuel_prices      ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_history    ENABLE ROW LEVEL SECURITY;
ALTER TABLE national_averages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Lettura pubblica stations"
  ON stations FOR SELECT USING (true);

CREATE POLICY "Lettura pubblica fuel_prices"
  ON fuel_prices FOR SELECT USING (true);

CREATE POLICY "Lettura pubblica price_history"
  ON price_history FOR SELECT USING (true);

CREATE POLICY "Lettura pubblica national_averages"
  ON national_averages FOR SELECT USING (true);

-- Scrittura solo con service_role key (usata dallo scheduler)
-- Le policy di scrittura non servono perché service_role bypassa RLS
