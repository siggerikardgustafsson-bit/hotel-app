// Multi-property-stöd. Varje hotell lagras under sin egen property_id i
// Supabase (rooms/bookings/housekeeping). UI:t filtrerar alltid på vald
// property och nya rader får property_id satt vid sparande.

export const PROPERTIES = [
  { id: 'vanersborg', name: 'Hotell Vänersborg' },
  { id: 'bralanda', name: 'Brålanda' },
]

export const DEFAULT_PROPERTY_ID = 'vanersborg'

const STORAGE_KEY = 'hotel-app:property'

export function propertyName(id) {
  return PROPERTIES.find(p => p.id === id)?.name || id
}

export function getStoredProperty() {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (PROPERTIES.some(p => p.id === v)) return v
  } catch { /* localStorage saknas */ }
  return DEFAULT_PROPERTY_ID
}

export function storeProperty(id) {
  try { localStorage.setItem(STORAGE_KEY, id) } catch { /* ignore */ }
}
