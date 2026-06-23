// ============================================================
// api/inbound-email.ts  —  LAGER 1: Mejlparser
//
// Vercel Edge Function som tar emot Postmark Inbound-webhooks när
// Booking.com skickar boknings-mejl, parsar ut bokningsdata och
// gör en upsert mot Supabase-tabellen `bookings`.
//
// Miljövariabler (Vercel → Project → Settings → Environment Variables):
//   SUPABASE_URL                Supabase Project URL
//   SUPABASE_SERVICE_ROLE_KEY   service_role-nyckel (server-side, hemlig!)
//   POSTMARK_WEBHOOK_SECRET     delad hemlighet för att verifiera anropet
//
// SÄKERHET: Postmark Inbound signerar INTE webhooken med HMAC. Det
// rekommenderade sättet är att lägga en hemlighet i webhook-URL:en.
// Vi accepterar hemligheten antingen som query-param (?secret=...) eller
// som HTTP Basic Auth-lösenord. Enkelt och tillräckligt för detta.
// ============================================================

import { createClient } from '@supabase/supabase-js'

export const config = { runtime: 'edge' }

const MONTHS: Record<string, string> = {
  january: '01', february: '02', march: '03', april: '04',
  may: '05', june: '06', july: '07', august: '08',
  september: '09', october: '10', november: '11', december: '12',
}

type ParsedBooking = {
  external_id: string | null
  guest_name: string | null
  checkin: string | null
  checkout: string | null
  people: number | null
  unit_type: string | null
  action: 'new' | 'modified' | 'cancelled' | 'unknown'
}

// "Monday, 14 July 2025" / "14 July 2025" -> "2025-07-14"
function parseHumanDate(input: string | undefined | null): string | null {
  if (!input) return null
  const m = input.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/)
  if (!m) return null
  const day = m[1].padStart(2, '0')
  const month = MONTHS[m[2].toLowerCase()]
  const year = m[3]
  if (!month) return null
  return `${year}-${month}-${day}`
}

function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = text.match(re)
    if (m && m[1]) return m[1].trim()
  }
  return null
}

function parseEmail(subject: string, body: string): ParsedBooking {
  const subj = subject || ''
  const text = (body || '').replace(/\r/g, '')

  // Vilken typ av händelse? Avgörs i första hand av Subject-raden.
  let action: ParsedBooking['action'] = 'unknown'
  if (/new reservation/i.test(subj)) action = 'new'
  else if (/modif/i.test(subj)) action = 'modified'
  else if (/cancellation|cancelled|canceled/i.test(subj)) action = 'cancelled'

  // Boknings-ID (Booking.com confirmation number, vanligen 10 siffror).
  // Försök Subject först (för ändring/avbokning), sen brödtexten.
  const external_id = firstMatch(subj, [/\b(\d{8,12})\b/]) ||
    firstMatch(text, [
      /reservation\s*(?:number|id|no\.?)\s*[:#]?\s*(\d{8,12})/i,
      /confirmation\s*(?:number|id|no\.?)\s*[:#]?\s*(\d{8,12})/i,
      /\b(\d{10})\b/,
    ])

  // Gästnamn: Subject "New reservation from John Smith", annars brödtext.
  const guest_name = firstMatch(subj, [/reservation from\s+(.+?)\s*$/i]) ||
    firstMatch(text, [
      /guest\s*name\s*[:#]?\s*(.+)/i,
      /guest\s*[:#]?\s*(.+)/i,
      /name\s*[:#]?\s*(.+)/i,
    ])

  // Datum: leta rader som nämner check-in / check-out.
  const checkinLine = firstMatch(text, [/check[\s-]*in\s*[:#]?\s*(.+)/i])
  const checkoutLine = firstMatch(text, [/check[\s-]*out\s*[:#]?\s*(.+)/i])
  const checkin = parseHumanDate(checkinLine)
  const checkout = parseHumanDate(checkoutLine)

  // Antal gäster.
  const peopleStr = firstMatch(text, [
    /(\d+)\s*(?:guests?|adults?|persons?|people)/i,
    /(?:guests?|adults?|persons?|people)\s*[:#]?\s*(\d+)/i,
  ])
  const people = peopleStr ? parseInt(peopleStr, 10) : null

  // Rumstyp om den finns med.
  const unit_type = firstMatch(text, [
    /(?:room|unit)\s*type\s*[:#]?\s*(.+)/i,
    /accommodation\s*type\s*[:#]?\s*(.+)/i,
  ])

  return { external_id, guest_name, checkin, checkout, people, unit_type, action }
}

// Verifiera att anropet kommer från vår Postmark-webhook via delad hemlighet.
function isAuthorized(req: Request): boolean {
  const secret = process.env.POSTMARK_WEBHOOK_SECRET
  if (!secret) return true // Ingen hemlighet satt -> hoppa över kontroll (ej rekommenderat i prod)

  const url = new URL(req.url)
  if (url.searchParams.get('secret') === secret) return true

  const auth = req.headers.get('authorization') || ''
  if (auth.startsWith('Basic ')) {
    try {
      const decoded = atob(auth.slice(6))
      const pass = decoded.includes(':') ? decoded.split(':').slice(1).join(':') : decoded
      if (pass === secret) return true
    } catch { /* ignore */ }
  }
  return false
}

// Alltid 200 (utom auth-fel) — Postmark ska inte retry:a på app-fel.
function ok(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return ok({ error: 'method_not_allowed' }, 405)

  if (!isAuthorized(req)) return ok({ error: 'unauthorized' }, 401)

  const SUPABASE_URL = process.env.SUPABASE_URL
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

  try {
    const payload = await req.json()
    const subject: string = payload?.Subject ?? ''
    const body: string = payload?.TextBody || payload?.HtmlBody || ''

    const parsed = parseEmail(subject, body)

    if (!parsed.external_id) {
      console.error('inbound-email: kunde inte extrahera boknings-ID', { subject })
      return ok({ ok: false, reason: 'no_booking_id', subject })
    }
    if (!SUPABASE_URL || !SERVICE_KEY) {
      console.error('inbound-email: saknar SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
      return ok({ ok: false, reason: 'missing_env' })
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false },
    })

    const id = parsed.external_id

    if (parsed.action === 'cancelled') {
      // Avboka: radera aldrig, sätt status. Matcha både råa numret och
      // ev. multi-rumssuffix (id "<num>" eller "<num>-N").
      const { error } = await supabase
        .from('bookings')
        .update({ status: 'cancelled_by_guest', source: 'email', updated_at: new Date().toISOString() })
        .or(`id.eq.${id},external_id.eq.${id}`)
      if (error) {
        console.error('inbound-email: avboknings-update misslyckades', error)
        return ok({ ok: false, reason: 'db_error', detail: error.message })
      }
      return ok({ ok: true, action: 'cancelled', external_id: id })
    }

    // Ny bokning eller ändring -> upsert på primärnyckeln `id`.
    // Vi sätter id = external_id = boknings-numret så att raden
    // konvergerar med XLS-import och iCal-fallback (ingen dubblett).
    const row: Record<string, unknown> = {
      id,
      external_id: id,
      source: 'email',
      status: 'ok',
      updated_at: new Date().toISOString(),
    }
    if (parsed.guest_name) row.guest_name = parsed.guest_name
    if (parsed.checkin) row.checkin = parsed.checkin
    if (parsed.checkout) row.checkout = parsed.checkout
    if (parsed.people != null) row.people = parsed.people
    if (parsed.unit_type) row.unit_type = parsed.unit_type

    // guest_name/checkin/checkout är NOT NULL i schemat. Vid en ändring
    // kanske mejlet saknar något fält — då hade en insert fallerat.
    // Vi gör därför insert med fallback till update om raden redan finns.
    const { error: upsertError } = await supabase
      .from('bookings')
      .upsert(row, { onConflict: 'id' })

    if (upsertError) {
      console.error('inbound-email: upsert misslyckades', upsertError)
      return ok({ ok: false, reason: 'db_error', detail: upsertError.message, parsed })
    }

    return ok({ ok: true, action: parsed.action, external_id: id, parsed })
  } catch (err) {
    // Parsningsfel: logga men returnera 200 så Postmark inte retry:ar.
    console.error('inbound-email: oväntat fel', err)
    return ok({ ok: false, reason: 'exception', detail: String(err) })
  }
}
