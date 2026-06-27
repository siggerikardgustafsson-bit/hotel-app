import { supabase } from './supabase'

// En bokning räknas som aktiv om den inte är avbokad. Mejl/iCal-synken
// sätter status till 'cancelled_by_guest' vid avbokning (XLS-importen
// hoppar över avbokade rader helt). Vi gömmer avbokade rader i UI:t.
export function isActiveBooking(b) {
  const s = String(b?.status || '').toLowerCase()
  return !s.includes('cancel')
}

// Prenumerera på realtidsändringar i `bookings` och håll lokal state
// i synk. Returnerar en cleanup-funktion som tar bort kanalen.
//
// setBookings: React state-settern för bokningslistan.
// propertyId:  filtrera så att bara raderna för valt hotell påverkas.
export function subscribeToBookings(setBookings, propertyId) {
  // En INSERT/UPDATE för ett annat hotell ska inte dyka upp i denna vy.
  // En DELETE skickar bara `old` (ev. utan property_id), så vi filtrerar
  // defensivt på lokal lista istället.
  const belongs = (row) => !propertyId || !row?.property_id || row.property_id === propertyId

  const channel = supabase
    .channel(`bookings-changes-${propertyId || 'all'}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'bookings' },
      (payload) => {
        setBookings((prev) => {
          const list = prev || []
          if (payload.eventType === 'INSERT') {
            const row = payload.new
            if (!belongs(row)) return list
            const without = list.filter((b) => b.id !== row.id)
            return isActiveBooking(row) ? [...without, row] : without
          }
          if (payload.eventType === 'UPDATE') {
            const row = payload.new
            if (!belongs(row)) return list.filter((b) => b.id !== row.id)
            // Avbokad -> ta bort ur listan, annars ersätt/lägg till.
            if (!isActiveBooking(row)) return list.filter((b) => b.id !== row.id)
            const exists = list.some((b) => b.id === row.id)
            return exists
              ? list.map((b) => (b.id === row.id ? row : b))
              : [...list, row]
          }
          if (payload.eventType === 'DELETE') {
            return list.filter((b) => b.id !== payload.old.id)
          }
          return list
        })
      }
    )
    .subscribe()

  return () => { supabase.removeChannel(channel) }
}
