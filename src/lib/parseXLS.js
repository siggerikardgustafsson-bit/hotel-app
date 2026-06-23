import * as XLSX from 'xlsx'

const COL_MAP = {
  'Book Number': 'id',
  'Booked by': 'booked_by',
  'Guest Name(s)': 'guest_name',
  'Check-in': 'checkin',
  'Check-out': 'checkout',
  'Status': 'status',
  'Unit type': 'unit_type',
  'Rooms': 'rooms',
  'People': 'people',
  'Remarks': 'remarks',
  'Price': 'price',
}

function parseDate(val) {
  if (!val) return null

  if (typeof val === 'number') {
    const date = XLSX.SSF.parse_date_code(val)
    if (!date) return null
    return `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`
  }

  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    return `${val.getFullYear()}-${String(val.getMonth() + 1).padStart(2, '0')}-${String(val.getDate()).padStart(2, '0')}`
  }

  const str = String(val).trim()
  if (!str) return null

  // Handles normal ISO-ish strings from XLS/XLSX exports.
  const isoMatch = str.match(/\d{4}-\d{2}-\d{2}/)
  if (isoMatch) return isoMatch[0]

  return str.slice(0, 10)
}

function cleanText(value) {
  return String(value ?? '')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function toInt(value, fallback = 0) {
  const n = parseInt(value, 10)
  return Number.isFinite(n) ? n : fallback
}

function stableBookingId(value) {
  return cleanText(value).replace(/\.0$/, '')
}

function displayNameFromBookedBy(value) {
  const cleaned = cleanText(value)
  const match = cleaned.match(/^([^,]+),\s*(.+)$/)
  return match ? `${match[2]} ${match[1]}`.trim() : cleaned
}

function splitMultiRoomUnitTypes(unitType, roomCount) {
  const cleaned = cleanText(unitType)
  if (!cleaned) return []
  if (roomCount <= 1) return [cleaned]

  // Booking.com multi-room exports commonly look like:
  // "Studio med kök utan spis (17), Familjesviten (9 & 16)"
  // This first tries to split those into one imported booking row per booked room.
  const commaParts = cleaned
    .split(/\s*,\s*/)
    .map(part => part.trim())
    .filter(Boolean)

  if (commaParts.length === roomCount) return commaParts

  // More careful fallback: grab chunks ending in a parenthesized room candidate group.
  // Useful if spacing around commas is inconsistent.
  const parenthesizedParts = cleaned.match(/[^,]+?\([^)]*\)/g)?.map(part => part.trim()).filter(Boolean) || []
  if (parenthesizedParts.length === roomCount) return parenthesizedParts

  // If the export says 2+ rooms but only gives one category string, keep every room as
  // its own assignable row instead of silently losing the extra room.
  return Array.from({ length: roomCount }, (_, idx) => `${cleaned}${roomCount > 1 ? ` · rum ${idx + 1}` : ''}`)
}

function inferRoomId(unitType) {
  const candidates = extractRoomCandidates(unitType)

  // Safe auto-assignment: only when the Booking.com category points to exactly one room.
  // For ambiguous strings such as "Familjesviten (9 & 16)", leave it null so staff chooses.
  return candidates.length === 1 ? candidates[0] : null
}

export function parseBookingXLS(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result)
        const workbook = XLSX.read(data, { type: 'array', cellDates: false })
        const sheet = workbook.Sheets[workbook.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })

        if (rows.length < 2) {
          reject(new Error('Filen verkar tom'))
          return
        }

        const headers = rows[0].map(h => cleanText(h))
        const bookings = []

        for (let i = 1; i < rows.length; i++) {
          const row = rows[i]
          if (!row[0]) continue

          const obj = {}
          headers.forEach((h, idx) => {
            const field = COL_MAP[h]
            if (field) obj[field] = row[idx]
          })

          if (obj.status && cleanText(obj.status).toLowerCase().includes('cancel')) continue

          obj.checkin = parseDate(obj.checkin)
          obj.checkout = parseDate(obj.checkout)
          obj.id = stableBookingId(obj.id)
          obj.guest_name = cleanText(obj.guest_name) || displayNameFromBookedBy(obj.booked_by)
          obj.unit_type = cleanText(obj.unit_type)
          obj.status = cleanText(obj.status)
          obj.remarks = cleanText(obj.remarks)
          obj.people = toInt(obj.people, 1)
          obj.rooms = toInt(obj.rooms, 1)

          if (!obj.id || !obj.guest_name || !obj.checkin || !obj.checkout) continue

          const originalId = obj.id
          const unitTypes = splitMultiRoomUnitTypes(obj.unit_type, obj.rooms)
          const isMultiRoom = unitTypes.length > 1

          unitTypes.forEach((unit, idx) => {
            bookings.push({
              ...obj,
              id: isMultiRoom ? `${originalId}-${idx + 1}` : originalId,
              unit_type: unit,
              rooms: 1,
              multi_room_original_id: isMultiRoom ? originalId : null,
              multi_room_index: isMultiRoom ? idx + 1 : null,
              multi_room_total: isMultiRoom ? unitTypes.length : null,
              room_id: inferRoomId(unit),
            })
          })
        }

        resolve(bookings)
      } catch (err) {
        reject(err)
      }
    }

    reader.onerror = () => reject(new Error('Kunde inte läsa filen'))
    reader.readAsArrayBuffer(file)
  })
}

export function extractRoomCandidates(unitType) {
  if (!unitType) return []

  const text = cleanText(unitType)

  // Prefer numbers inside the final parentheses: "Familjesviten (9 & 16)" -> ["9", "16"].
  const parenGroups = [...text.matchAll(/\(([^)]*)\)/g)]
  const lastGroup = parenGroups.at(-1)?.[1]
  const source = lastGroup || text

  const matches = source.match(/\d+/g) || []

  return [...new Set(matches.map(String))]
}
