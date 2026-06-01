# Scintilla PRO — Setup Completo
## Architettura

```
GitHub Actions (ogni mattina 08:30 IT)
    ↓ scarica CSV MIMIT
Supabase PostgreSQL + PostGIS
    ↓ query veloci per raggio GPS
Vercel Backend API
    ↓ risposta JSON
scintilla.html (su iltiratore.eu)
```

---

## STEP 1 — Database Supabase

1. Vai su https://supabase.com → il tuo progetto `scintilla-pro`
2. Nel menu a sinistra clicca **SQL Editor**
3. Copia e incolla tutto il contenuto di `database/schema.sql`
4. Clicca **Run**

Vedrai creare le tabelle: `stations`, `fuel_prices`, `price_history`, `national_averages`

---

## STEP 2 — GitHub Secrets

Nel tuo repository GitHub:
1. Vai in **Settings → Secrets and variables → Actions**
2. Clicca **New repository secret** e aggiungi questi due:

| Nome | Valore |
|------|--------|
| `SUPABASE_URL` | `https://lemngbvwonmlraakwhdz.supabase.co/rest/v1` |
| `SUPABASE_SERVICE_KEY` | *(copia dal pannello Supabase → Settings → API → secret key)* |

---

## STEP 3 — Carica i file su GitHub

Carica tutta la cartella `.github/` nel tuo repository GitHub.
Struttura:
```
.github/
  workflows/
    update-mimit.yml
  scripts/
    update-mimit.js
    package.json
```

---

## STEP 4 — Lancia il primo aggiornamento manualmente

1. Vai nel tuo repository GitHub
2. Clicca **Actions** nel menu in alto
3. Clicca **Aggiorna prezzi MIMIT → Supabase**
4. Clicca **Run workflow** → **Run workflow**

Aspetta 2-3 minuti. Se vedi ✅ verde, Supabase è popolato con tutti i dati MIMIT.

---

## STEP 5 — Deploy backend Vercel

```powershell
cd scintilla-system\backend
vercel link    # link al progetto scintilla-api esistente
vercel --prod
```

Poi vai su **Vercel Dashboard → scintilla-api → Settings → Environment Variables**
e aggiungi:

| Nome | Valore |
|------|--------|
| `SUPABASE_ANON_KEY` | *(copia dal pannello Supabase → Settings → API → publishable key)* |

Poi rideploya:
```powershell
vercel --prod
```

---

## STEP 6 — Verifica

Apri nel browser:
```
https://scintilla-api.vercel.app/api/prezzi-medi
```

Deve mostrare `"ok": true` con i prezzi reali MIMIT.

Poi testa la ricerca stazioni (esempio Livorno):
```
https://scintilla-api.vercel.app/api/stazioni?lat=43.548&lon=10.311&km=10&carb=benzina
```

---

## Aggiornamento automatico

Da domani mattina alle 08:30 IT GitHub Actions aggiorna tutto da solo — nessuna azione richiesta.
