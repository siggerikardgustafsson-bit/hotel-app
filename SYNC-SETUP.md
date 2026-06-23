# Automatisk bokningssynk – setup & test

Tre lager som håller `bookings` i synk med Booking.com:

1. **Mejlparser** (`api/inbound-email.ts`) – Vercel Edge Function, tar emot
   Postmark Inbound-webhooks i realtid.
2. **Supabase Realtime** (`src/lib/realtime.js`) – React-appen får INSERT/
   UPDATE/DELETE live, ingen omladdning behövs.
3. **iCal-fallback** (`supabase/functions/ical-sync/index.ts`) – Supabase Edge
   Function som körs nattligen kl 03:00 via pg_cron.

> **Designval:** Schemat använder `id` (PK) som Booking.com-bokningsnummer
> (inte `external_id`). Alla tre lager upsertar därför på `id` så att samma
> bokning från XLS/mejl/iCal hamnar i **en** rad. Vi lägger ändå till
> `external_id` (råa numret) + `source` ('manual'|'xls'|'email'|'ical').
> iCal skriver aldrig över en rad där `source='email'` (mejlet har mer info).
> Avbokning sätter `status='cancelled_by_guest'` (befintlig schemakonvention),
> och UI:t döljer numera avbokade rader.

---

## 1. Miljövariabler

| Variabel | Var | Värde |
|---|---|---|
| `REACT_APP_SUPABASE_URL` | Vercel | Supabase Project URL |
| `REACT_APP_SUPABASE_ANON_KEY` | Vercel | anon-nyckeln |
| `REACT_APP_ADMIN_EMAIL` | Vercel | din admin-mejl |
| `SUPABASE_URL` | Vercel | Supabase Project URL (samma, utan prefix) |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel | service_role-nyckeln (HEMLIG) |
| `POSTMARK_WEBHOOK_SECRET` | Vercel | egen slumpsträng (`openssl rand -hex 24`) |
| `BOOKING_ICAL_URL` | Supabase secrets | iCal-feed från Extranet |

Vercel: Project → Settings → Environment Variables.
Supabase: `supabase secrets set BOOKING_ICAL_URL="..."`

## 2. SQL – kör i ordning (Supabase → SQL Editor)

1. `supabase/migrations/001_sync_columns.sql` – kolumner, index, Realtime.
2. `supabase/migrations/002_ical_cron.sql` – **byt ut `<PROJECT_REF>` och
   `<SERVICE_ROLE_KEY>` först**. Kör EFTER att `ical-sync` deployats.

## 3. Postmark (mejlparser)

1. Skapa konto på postmarkapp.com → skapa en **Server**.
2. Lägg till en **Inbound Stream**. Postmark ger en inbound-mejladress
   (`xxxx@inbound.postmarkapp.com`).
3. Sätt **Inbound Webhook URL** till:
   `https://DIN-VERCEL-DOMAIN/api/inbound-email?secret=DITT_POSTMARK_WEBHOOK_SECRET`
4. I Booking.com Extranet → **Account → Notifications/Email** (eller en regel i
   din vanliga inkorg): vidarebefordra boknings-mejlen till Postmark-adressen.

## 4. iCal-URL i Booking.com Extranet

Extranet → **Rates & Availability → Calendar** (eller **Sync calendars /
Connect calendar**) → **Export calendar**. Kopiera URL:en som börjar med
`https://admin.booking.com/hotel/hoteladmin/ical.html?...`. Det finns en feed
per rumstyp – ta den (eller de) du vill synka.

## 5. Deploy

```bash
# Mejlparser (Vercel) – deployas automatiskt vid git push, eller:
git push                      # Vercel bygger api/inbound-email.ts

# iCal-funktion (Supabase)
supabase login
supabase link --project-ref <PROJECT_REF>
supabase secrets set BOOKING_ICAL_URL="https://admin.booking.com/.../ical.html?..."
supabase functions deploy ical-sync
```

## 6. Testa varje lager manuellt

**Lager 1 – mejlparser:** skicka en test-POST (byt domän + secret):
```bash
curl -X POST "https://DIN-DOMAIN/api/inbound-email?secret=DIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"Subject":"New reservation from John Smith",
       "TextBody":"Reservation number: 4123456789\nGuest name: John Smith\nCheck-in: Monday, 14 July 2025\nCheck-out: Wednesday, 16 July 2025\n2 guests\nRoom type: Balkongrum"}'
```
Förvänta `{"ok":true,...}` och en ny rad i `bookings` (id 4123456789).
Testa avbokning: `{"Subject":"Cancellation of reservation 4123456789","TextBody":"..."}`
→ raden får `status='cancelled_by_guest'` och försvinner ur UI:t.

**Lager 2 – Realtime:** öppna appen i två flikar (eller kör curlen ovan).
Ändringen ska dyka upp i kalender/lista direkt utan omladdning. Kontrollera i
Supabase → Database → Replication att `bookings` ligger i `supabase_realtime`.

**Lager 3 – iCal:** anropa funktionen manuellt:
```bash
curl -X POST "https://<PROJECT_REF>.supabase.co/functions/v1/ical-sync" \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>"
```
Förvänta JSON: `{total, upserted, cancelled, errors, timestamp}`.
Cron-historik: `select * from cron.job_run_details order by start_time desc limit 5;`
