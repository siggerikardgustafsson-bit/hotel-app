// ============================================================
// supabase/functions/ical-sync/index.ts  —  LAGER 3: iCal-fallback
//
// Supabase Edge Function (Deno) som körs nattligen kl 03:00 via
// pg_cron (se supabase/migrations/002_ical_cron.sql).
//
// Hämtar Booking.coms iCal-feed, parsar händelser och upsertar mot
// `bookings`. Skriver ALDRIG över en rad där source = 'email' (mejlet
// har mer info än iCal:en).
//
// Miljövariabler (sätts med: supabase secrets set ...):
//   SUPABASE_URL                injiceras automatiskt i edge runtime
//   SUPABASE_SERVICE_ROLE_KEY   injiceras automatiskt i edge runtime
//   BOOKING_ICAL_URL            iCal-feed-URL från Booking.com Extranet
// ============================================================

import { createClient } from 'jsr:@supabase/supabase-js@2'

type IcalEvent = Record<string, string>

// iCal kan radbryta långa värden ("folding"): en rad som börjar med
// mellanslag/tab är en fortsättning på föregående rad. Veckla ut först.
function unfold(raw: string): string[] {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n')
}

function parseEvents(raw: string): IcalEvent[] {
  const lines = unfold(raw)
  const events: IcalEvent[] = []
  let current: IcalEvent | null = null

  for (const line of lines) {
    if (line.startsWith('BEGIN:VEVENT')) { current = {} ; continue }
    if (line.startsWith('END:VEVENT')) { if (current) events.push(current); current = null; continue }
    if (!current) continue

    const idx = line.indexOf(':')
    if (idx === -1) continue
    // Nyckel kan ha parametrar, t.ex. "DTSTART;VALUE=DATE" -> ta del före ';'.
    const key = line.slice(0, idx).split(';')[0].trim().toUpperCase()
    const value = line.slice(idx + 1).trim()
    if (key) current[key] = value
  }
  return events
}

// "bdc-4123456789@booking.com" -> "4123456789"
function extractBookingId(uid: string | undefined): string | null {
  if (!uid) return null
  const m = uid.match(/(\d{6,})/)
  return m ? m[1] : null
}

// "20250714" -> "2025-07-14"
function parseIcalDate(value: string | undefined): string | null {
  if (!value) return null
  const m = value.match(/(\d{4})(\d{2})(\d{2})/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

// "John Smith (2)" -> "John Smith"
function extractGuestName(summary: string | undefined): string | null {
  if (!summary) return null
  return summary.replace(/\s*\(\d+\)\s*$/, '').trim() || null
}

Deno.serve(async (req) => {
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const ICAL_URL = Deno.env.get('BOOKING_ICAL_URL')

  const stats = { total: 0, upserted: 0, cancelled: 0, errors: 0, timestamp: new Date().toISOString() }

  if (!ICAL_URL) {
    return Response.json({ ...stats, error: 'BOOKING_ICAL_URL saknas' }, { status: 500 })
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  try {
    const res = await fetch(ICAL_URL)
    if (!res.ok) {
      return Response.json({ ...stats, error: `iCal-hämtning misslyckades: ${res.status}` }, { status: 502 })
    }
    const ical = await res.text()
    const events = parseEvents(ical)
    stats.total = events.length

    for (const ev of events) {
      try {
        const id = extractBookingId(ev.UID)
        if (!id) { stats.errors++; continue }

        const checkin = parseIcalDate(ev.DTSTART)
        const checkout = parseIcalDate(ev.DTEND)
        const guest_name = extractGuestName(ev.SUMMARY)
        const isCancelled = (ev.STATUS || '').toUpperCase() === 'CANCELLED'

        // Skydda mejl-data: hämta ev. befintlig rad. Om den kommer från
        // 'email' låter vi iCal:en bara röra status (avbokning), aldrig
        // skriva över de rikare mejl-fälten.
        const { data: existing } = await supabase
          .from('bookings')
          .select('id, source')
          .or(`id.eq.${id},external_id.eq.${id}`)
          .maybeSingle()

        if (isCancelled) {
          if (existing) {
            await supabase
              .from('bookings')
              .update({ status: 'cancelled_by_guest', updated_at: new Date().toISOString() })
              .eq('id', existing.id)
          }
          stats.cancelled++
          continue
        }

        if (existing?.source === 'email') {
          // Mejlet äger raden — iCal lägger inte till sämre data.
          continue
        }

        // NOT NULL-kolumner: hoppa över ofullständiga händelser vid nyinsättning.
        if (!existing && (!guest_name || !checkin || !checkout)) { stats.errors++; continue }

        const row: Record<string, unknown> = {
          id,
          external_id: id,
          source: 'ical',
          status: 'ok',
          updated_at: new Date().toISOString(),
        }
        if (guest_name) row.guest_name = guest_name
        if (checkin) row.checkin = checkin
        if (checkout) row.checkout = checkout

        const { error } = await supabase.from('bookings').upsert(row, { onConflict: 'id' })
        if (error) { stats.errors++; console.error('upsert-fel', id, error.message); continue }
        stats.upserted++
      } catch (evErr) {
        stats.errors++
        console.error('event-fel', evErr)
      }
    }

    return Response.json(stats)
  } catch (err) {
    console.error('ical-sync: oväntat fel', err)
    return Response.json({ ...stats, error: String(err) }, { status: 500 })
  }
})
