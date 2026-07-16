import React, { useEffect, useState } from 'react'
import { supabase, signOut } from '../lib/supabase'
import { subscribeToBookings, isActiveBooking } from '../lib/realtime'
import { parseBookingXLS, extractRoomCandidates } from '../lib/parseXLS'
import { PROPERTIES, getStoredProperty, storeProperty, propertyName } from '../lib/properties'
import { format, addDays, startOfWeek, isSameDay, parseISO, differenceInDays } from 'date-fns'
import { sv } from 'date-fns/locale'

function todayMidnight() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function fmtDay(d) { return format(d, 'EEE d/M', { locale: sv }) }
function fmtFull(d) { return format(parseISO(d), 'd MMM yyyy', { locale: sv }) }
function ds(d) { return format(d, 'yyyy-MM-dd') }
function sortRooms(rooms) { return [...rooms].sort((a, b) => parseInt(a.id) - parseInt(b.id)) }

function isLongTermActive(room, date) {
  if (!room?.long_term_enabled) return false
  const d = typeof date === 'string' ? date : ds(date)
  const start = room.long_term_start || '0000-01-01'
  const end = room.long_term_end || '9999-12-31'
  return d >= start && d <= end
}

function isLongTermActiveInDays(room, days) {
  return days.some(d => isLongTermActive(room, d))
}

function roomSortNumber(room) {
  const n = parseInt(room?.id, 10)
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER
}

// Ur drift-rum sorteras alltid sist, oavsett övriga kriterier.
function roomOutOfOrderRank(room) {
  return room?.out_of_order ? 1 : 0
}

function bookableRoomSortRank(room, days) {
  if (!room?.long_term_enabled) return 1

  const weekStart = ds(days[0])
  const weekEnd = ds(days[days.length - 1])
  const activeInWeek = isLongTermActiveInDays(room, days)

  if (!activeInWeek) {
    return room.long_term_end && room.long_term_end < weekStart ? 0 : 1
  }

  return room.long_term_end && room.long_term_end < weekEnd ? 0 : 2
}

const EMPTY_ROOM = {
  id: '',
  name: '',
  type: '',
  capacity: 1,
  out_of_order: false,
  admin_notes: '',
  long_term_enabled: false,
  long_term_start: '',
  long_term_end: '',
  long_term_note: '',
}

const EMPTY_MANUAL_BOOKING = {
  guest_name: '',
  checkin: '',
  checkout: '',
  people: 1,
  unit_type: '',
  room_id: '',
  remarks: '',
  price: '',
  paid: false,
}

const NUM_DAYS = 7
const ROW_HEIGHT = 68
const ROW_HEIGHT_BRALANDA = 92
const ROOM_COL_PCT = 13


function useIsMobile() {
  const get = () => (typeof window !== 'undefined' ? window.innerWidth <= 760 : false)
  const [isMobile, setIsMobile] = useState(get)

  useEffect(() => {
    const onResize = () => setIsMobile(get())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return isMobile
}

// Håller "idag" uppdaterat vid dygnsskiftet även om sidan står öppen över natten
// (t.ex. receptionsdatorn), så att städ-/incheckningsstatus nollställs korrekt.
function useToday() {
  const [today, setToday] = useState(todayMidnight)

  useEffect(() => {
    let timer
    const scheduleNext = () => {
      const ms = todayMidnight().getTime() + 24 * 60 * 60 * 1000 - Date.now() + 1000
      timer = setTimeout(() => {
        setToday(todayMidnight())
        scheduleNext()
      }, ms)
    }
    scheduleNext()
    return () => clearTimeout(timer)
  }, [])

  return today
}

const glassPanel = {
  background: 'rgba(255,255,255,0.64)',
  border: '1px solid rgba(255,255,255,0.72)',
  boxShadow: '0 18px 45px rgba(86, 104, 140, 0.14)',
  backdropFilter: 'blur(22px) saturate(1.5)',
  WebkitBackdropFilter: 'blur(22px) saturate(1.5)',
}

export default function AdminView() {
  const [rooms, setRooms] = useState([])
  const [bookings, setBookings] = useState([])
  const [tab, setTab] = useState('calendar') // 'calendar' | 'bookings' | 'import' | 'rooms'
  const [importing, setImporting] = useState(false)
  const [importPreview, setImportPreview] = useState([])
  const [importMsg, setImportMsg] = useState('')
  const [saving, setSaving] = useState({})
  const [modal, setModal] = useState(null) // booking for detail modal
  const [roomModal, setRoomModal] = useState(null) // room create/edit modal
  const [manualBookingModal, setManualBookingModal] = useState(false)
  const [summaryModal, setSummaryModal] = useState(false)
  const [cleaningModal, setCleaningModal] = useState(false)
  const [bookingSearch, setBookingSearch] = useState('')
  const TODAY = useToday()
  const [weekStart, setWeekStart] = useState(() => startOfWeek(TODAY, { weekStartsOn: 1 }))
  const [housekeeping, setHousekeeping] = useState({})
  const [calRef, setCalRef] = useState(null)
  const [calWidth, setCalWidth] = useState(900)
  const [propertyId, setPropertyId] = useState(getStoredProperty)
  const isMobile = useIsMobile()
  // De nya funktionerna nedan (redigerbara bokningar, städ/incheckning-kontroller,
  // betald-bock) är just nu bara aktiverade för Brålanda — Vänersborg är oförändrat.
  const isBralanda = propertyId === 'bralanda'
  const todayStr = ds(TODAY)

  useEffect(() => {
    // Byt hotell → rensa och ladda om allt filtrerat på vald property.
    setRooms([]); setBookings([]); setHousekeeping({})
    loadRooms(); loadBookings(); fetchHousekeeping()
    // Realtime: bokningar uppdateras live (mejl/iCal-synk, andra flikar).
    const unsubscribe = subscribeToBookings(setBookings, propertyId)
    return unsubscribe
  }, [propertyId])

  function changeProperty(id) {
    if (id === propertyId) return
    storeProperty(id)
    setPropertyId(id)
    setTab('calendar')
    setModal(null); setRoomModal(null); setManualBookingModal(false)
    setImportPreview([]); setImportMsg(''); setBookingSearch('')
  }

  useEffect(() => {
    if (!calRef) return
    const obs = new ResizeObserver(entries => setCalWidth(entries[0].contentRect.width))
    obs.observe(calRef)
    return () => obs.disconnect()
  }, [calRef])

  async function loadRooms() {
    const { data } = await supabase.from('rooms').select('*').eq('property_id', propertyId)
    setRooms(sortRooms(data || []))
  }
  async function loadBookings() {
    const { data } = await supabase.from('bookings').select('*').eq('property_id', propertyId).order('checkin')
    setBookings((data || []).filter(isActiveBooking))
  }
  async function fetchHousekeeping() {
    const { data } = await supabase.from('housekeeping').select('*').eq('property_id', propertyId)
    const map = {}
    ;(data || []).forEach(h => { map[`${h.room_id}_${h.date}`] = h })
    setHousekeeping(map)
  }

  async function upsertHK(roomId, date, patch) {
    const key = `${roomId}_${date}`
    const { data, error } = await supabase
      .from('housekeeping')
      .upsert({ room_id: roomId, date, property_id: propertyId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'room_id,date' })
      .select()
      .single()
    if (error) { alert('Kunde inte spara städstatus: ' + error.message); return }
    if (data) setHousekeeping(prev => ({ ...prev, [key]: data }))
  }

  function toggleCleaning(roomId, date) {
    const key = `${roomId}_${date}`
    const cur = housekeeping[key]
    upsertHK(roomId, date, { cleaning_status: cur?.cleaning_status === 'done' ? 'pending' : 'done' })
  }

  async function updateBookingFields(id, patch) {
    setSaving(prev => ({ ...prev, [id]: true }))
    const { data, error } = await supabase
      .from('bookings')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single()
    setSaving(prev => ({ ...prev, [id]: false }))

    if (error) {
      alert('Kunde inte spara: ' + error.message)
      return
    }
    if (data) {
      setBookings(prev => prev.map(b => b.id === id ? data : b))
      if (modal?.id === id) setModal(data)
    }
  }

  async function handleXLSFile(e) {
    const file = e.target.files?.[0]; if (!file) return
    setImporting(true); setImportMsg('')
    try { setImportPreview(await parseBookingXLS(file)) }
    catch (err) { setImportMsg('Fel: ' + err.message) }
    setImporting(false)
  }

  async function saveImport() {
    if (!importPreview.length) return

    setSaving({ _import: true })
    setImportMsg('')

    const cancelledRows = importPreview.filter(b => b.import_cancelled)
    const activeRows = importPreview.filter(b => !b.import_cancelled)
    const cancelledIds = [...new Set(cancelledRows.map(b => b.id).filter(Boolean))]
    const ids = [...new Set(activeRows.map(b => b.id).filter(Boolean))]

    if (cancelledIds.length > 0) {
      const { data: allRows, error: cancelFetchError } = await supabase
        .from('bookings')
        .select('id, guest_name, checkin, checkout')
        .eq('property_id', propertyId)

      if (cancelFetchError) {
        setImportMsg('Fel vid kontroll av avbokningar: ' + cancelFetchError.message)
        setSaving({})
        return
      }

      const cancelledById = new Set(cancelledIds)
      const cancelledKeys = new Set(cancelledRows.map(b => `${b.guest_name || ''}|${b.checkin || ''}|${b.checkout || ''}`))
      const deleteIds = (allRows || [])
        .filter(row => {
          const originalId = String(row.id || '').split('-')[0]
          const key = `${row.guest_name || ''}|${row.checkin || ''}|${row.checkout || ''}`
          return cancelledById.has(originalId) || cancelledKeys.has(key)
        })
        .map(row => row.id)

      if (deleteIds.length > 0) {
        const { error: deleteError } = await supabase.from('bookings').delete().in('id', deleteIds)
        if (deleteError) {
          setImportMsg('Fel vid borttagning av avbokningar: ' + deleteError.message)
          setSaving({})
          return
        }
      }
    }

    // Ta bort eventuella gamla osplittade rader för bokningar som nu är multi-rum.
    // T.ex. om bokning "123" tidigare importerades som en rad men nu splittats till "123-1" och "123-2".
    const originalIds = [...new Set(activeRows.map(b => b.multi_room_original_id).filter(Boolean))]
    if (originalIds.length > 0) {
      await supabase.from('bookings').delete().eq('property_id', propertyId).in('id', originalIds)
    }

    if (!activeRows.length) {
      setImportMsg(`✓ ${cancelledIds.length} avbokade`)
      setImportPreview([])
      loadBookings()
      setSaving({})
      return
    }

    // Hämta befintliga bokningar så manuellt tilldelade rum bevaras vid återimport.
    const { data: existingRows, error: fetchError } = await supabase
      .from('bookings')
      .select('id, room_id, paid')
      .eq('property_id', propertyId)
      .in('id', ids)

    if (fetchError) {
      setImportMsg('Fel vid kontroll av befintliga bokningar: ' + fetchError.message)
      setSaving({})
      return
    }

    const existingById = new Map((existingRows || []).map(row => [row.id, row]))
    const merged = activeRows.map(incoming => {
      const existing = existingById.get(incoming.id)
      const row = {
        ...incoming,
        property_id: propertyId,
        room_id: incoming.room_id || existing?.room_id || null,
      }
      // Bokningar från Booking.com räknas som betalda automatiskt vid import,
      // om inte personal redan manuellt ändrat betald-status på en befintlig rad.
      if (isBralanda) row.paid = existing ? existing.paid : true
      return row
    })

    const { error } = await supabase
      .from('bookings')
      .upsert(merged, { onConflict: 'id' })

    if (error) {
      setImportMsg('Fel vid sparande: ' + error.message)
    } else {
      const existingCount = merged.filter(b => existingById.has(b.id)).length
      const newCount = merged.length - existingCount
      const cancelledCount = cancelledIds.length
      const cancelledMsg = cancelledCount ? `, ${cancelledCount} avbokade` : ''
      setImportMsg(`✓ ${newCount} nya, ${existingCount} uppdaterade${cancelledMsg}`)
      setImportPreview([])
      loadBookings()
    }

    setSaving({})
  }

  async function assignRoom(bookingId, roomId) {
    setSaving(prev => ({ ...prev, [bookingId]: true }))
    await supabase.from('bookings').update({ room_id: roomId || null }).eq('id', bookingId)
    setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, room_id: roomId || null } : b))
    if (modal?.id === bookingId) setModal(prev => ({ ...prev, room_id: roomId || null }))
    setSaving(prev => ({ ...prev, [bookingId]: false }))
  }

  async function deleteBooking(id) {
    if (!window.confirm('Ta bort bokning?')) return
    await supabase.from('bookings').delete().eq('id', id)
    setBookings(prev => prev.filter(b => b.id !== id))
    setModal(null)
  }

  async function saveManualBooking(form) {
    const guestName = String(form.guest_name || '').trim()
    const checkin = String(form.checkin || '').trim()
    const checkout = String(form.checkout || '').trim()

    if (!guestName || !checkin || !checkout) {
      alert('Gäst, incheckning och utcheckning krävs.')
      return
    }
    if (checkout <= checkin) {
      alert('Utcheckning måste vara efter incheckning.')
      return
    }

    const id = `manual-${Date.now()}`
    const payload = {
      id,
      guest_name: guestName,
      checkin,
      checkout,
      unit_type: String(form.unit_type || '').trim() || 'Manuell bokning',
      room_id: form.room_id || null,
      people: parseInt(form.people, 10) || 1,
      status: 'ok',
      remarks: String(form.remarks || '').trim() || null,
      price: String(form.price || '').trim() || null,
      property_id: propertyId,
      updated_at: new Date().toISOString(),
    }
    if (isBralanda) payload.paid = !!form.paid

    setSaving(prev => ({ ...prev, _manualBooking: true }))
    const { data, error } = await supabase
      .from('bookings')
      .insert(payload)
      .select()
      .single()
    setSaving(prev => ({ ...prev, _manualBooking: false }))

    if (error) {
      alert('Kunde inte spara bokning: ' + error.message)
      return
    }

    setManualBookingModal(false)
    if (data) setBookings(prev => [...prev.filter(b => b.id !== data.id), data].filter(isActiveBooking))
    else await loadBookings()
  }

  async function saveRoom(form) {
    const cleanId = String(form.id || '').trim()
    const cleanName = String(form.name || '').trim()
    if (!cleanId || !cleanName) {
      alert('Rum-ID och namn krävs.')
      return
    }

    const payload = {
      id: cleanId,
      name: cleanName,
      type: String(form.type || '').trim(),
      capacity: parseInt(form.capacity, 10) || 1,
      property_id: propertyId,
      admin_notes: String(form.admin_notes || '').trim() || null,
      long_term_enabled: !!form.long_term_enabled,
      long_term_start: form.long_term_enabled && form.long_term_start ? form.long_term_start : null,
      long_term_end: form.long_term_enabled && form.long_term_end ? form.long_term_end : null,
      long_term_note: form.long_term_enabled && form.long_term_note ? String(form.long_term_note).trim() : null,
      updated_at: new Date().toISOString(),
    }
    if (isBralanda) payload.out_of_order = !!form.out_of_order

    setSaving(prev => ({ ...prev, _room: true }))
    const { error } = await supabase.from('rooms').upsert(payload, { onConflict: 'id' })
    setSaving(prev => ({ ...prev, _room: false }))

    if (error) {
      alert('Kunde inte spara rum: ' + error.message)
      return
    }

    setRoomModal(null)
    await loadRooms()
  }

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const unassigned = bookings.filter(b => !b.room_id)
  const assigned   = bookings.filter(b => b.room_id)
  const longTermRooms = rooms.filter(r => isLongTermActiveInDays(r, days))
  const checkoutsToday = bookings.filter(b => b.checkout === todayStr)
  const cleanDoneToday = checkoutsToday.filter(b => {
    const hk = housekeeping[`${b.room_id}_${todayStr}`]
    return hk?.cleaning_status === 'done' || hk?.checkout_done
  }).length

  const searchTerm = bookingSearch.trim().toLowerCase()
  function matchesSearch(b) {
    if (!searchTerm) return true
    const room = rooms.find(r => r.id === b.room_id)
    const haystack = [
      b.guest_name, b.unit_type, b.remarks, b.price,
      b.id, b.multi_room_original_id, room?.name, room?.id,
    ].filter(Boolean).join(' ').toLowerCase()
    return haystack.includes(searchTerm)
  }
  const unassignedFiltered = unassigned.filter(matchesSearch)
  const assignedFiltered = assigned.filter(matchesSearch)
  const adminDisplayRooms = [...rooms].sort((a, b) => {
    const aOoo = roomOutOfOrderRank(a)
    const bOoo = roomOutOfOrderRank(b)
    if (aOoo !== bOoo) return aOoo - bOoo
    const aRank = bookableRoomSortRank(a, days)
    const bRank = bookableRoomSortRank(b, days)
    if (aRank !== bRank) return aRank - bRank
    return roomSortNumber(a) - roomSortNumber(b)
  })

  const calendarBaseWidth = isMobile ? Math.max(calWidth, 860) : calWidth
  const gridW = calendarBaseWidth * (1 - ROOM_COL_PCT / 100)
  const dayW = gridW / NUM_DAYS
  const half = dayW / 2

  function getVisibleBookings(roomId) {
    const weekEnd = addDays(weekStart, NUM_DAYS)
    return bookings.filter(b => {
      if (b.room_id !== roomId || !b.checkin || !b.checkout) return false
      const ci = parseISO(b.checkin)
      const co = parseISO(b.checkout)
      return co >= weekStart && ci < weekEnd
    })
  }

  function bookingToPixels(b) {
    const ci = parseISO(b.checkin)
    const co = parseISO(b.checkout)
    const ciIdx = differenceInDays(ci, weekStart)
    const coIdx = differenceInDays(co, weekStart)
    const startsBeforeWeek = ciIdx < 0
    const endsAfterWeek = coIdx >= NUM_DAYS
    const startX = startsBeforeWeek ? 0 : ciIdx * dayW + half
    const endX = endsAfterWeek ? NUM_DAYS * dayW : coIdx * dayW + half
    if (endX <= startX) return null
    return { left: startX, width: endX - startX, booking: b, startsBeforeWeek, endsAfterWeek }
  }

  return (
    <div style={{ ...s.page, ...(isMobile ? s.pageMobile : {}) }}>

      {modal && (
        <DetailModal
          booking={modal} rooms={rooms} bookings={bookings}
          onClose={() => setModal(null)}
          onAssign={assignRoom}
          onDelete={deleteBooking}
          onUpdate={updateBookingFields}
          isBralanda={isBralanda}
          saving={saving[modal.id]}
        />
      )}

      {roomModal && (
        <RoomModal
          initial={roomModal}
          onClose={() => setRoomModal(null)}
          onSave={saveRoom}
          isBralanda={isBralanda}
          saving={saving._room}
        />
      )}

      {manualBookingModal && (
        <ManualBookingModal
          rooms={rooms}
          onClose={() => setManualBookingModal(false)}
          onSave={saveManualBooking}
          isBralanda={isBralanda}
          saving={saving._manualBooking}
        />
      )}

      {summaryModal && (
        <TodaySummaryModal
          bookings={bookings}
          rooms={rooms}
          propertyLabel={propertyName(propertyId)}
          today={TODAY}
          onClose={() => setSummaryModal(false)}
        />
      )}

      {cleaningModal && (
        <CleaningTodayModal
          checkouts={checkoutsToday}
          rooms={rooms}
          housekeeping={housekeeping}
          todayStr={todayStr}
          onToggleCleaning={toggleCleaning}
          onClose={() => setCleaningModal(false)}
        />
      )}

      <div style={{ ...s.topbar, ...(isMobile ? s.topbarMobile : {}) }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <span style={{ ...s.hotelName, ...(isMobile ? s.hotelNameMobile : {}) }}>{propertyName(propertyId)}</span>
            <span style={s.adminBadge}>Admin</span>
          </div>
          <div style={{ ...s.propSwitch, ...(isMobile ? s.propSwitchMobile : {}) }}>
            {PROPERTIES.map(p => (
              <button
                key={p.id}
                onClick={() => changeProperty(p.id)}
                style={{ ...s.propBtn, ...(p.id === propertyId ? s.propBtnActive : {}) }}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>
        <div style={{ ...s.tabs, ...(isMobile ? s.tabsMobile : {}) }}>
          <TabBtn label="Kalender" active={tab==='calendar'} onClick={() => setTab('calendar')} />
          <TabBtn label="Bokningar" active={tab==='bookings'} onClick={() => setTab('bookings')} />
          <TabBtn label="Importera XLS" active={tab==='import'} onClick={() => setTab('import')} badge={importPreview.length || null} />
          <TabBtn label="Rum" active={tab==='rooms'} onClick={() => setTab('rooms')} />
          <button style={{ ...s.signoutBtn, ...(isMobile ? s.signoutBtnMobile : {}) }} onClick={signOut}>Logga ut</button>
        </div>
      </div>

      {tab === 'calendar' && (
        <div>
          <div style={{ ...ac.viewHeader, ...(isMobile ? ac.viewHeaderMobile : {}) }}>
            <button style={{ ...ac.navBtn, ...(isMobile ? ac.navBtnMobile : {}) }} onClick={() => setWeekStart(d => addDays(d, -7))}>← Föregående</button>
            <div style={{ ...ac.titleWrap, ...(isMobile ? ac.titleWrapMobile : {}) }}>
              <div style={ac.kicker}>Admin · veckoöversikt</div>
              <div style={{ ...ac.title, ...(isMobile ? ac.titleMobile : {}) }}>
                {format(weekStart, 'd MMM', { locale: sv })} – {format(addDays(weekStart, 6), 'd MMM yyyy', { locale: sv })}
              </div>
            </div>
            <button style={{ ...ac.navBtn, ...(isMobile ? ac.navBtnMobile : {}) }} onClick={() => setWeekStart(d => addDays(d, 7))}>Nästa →</button>
          </div>

          <div style={ac.summaryBar}>
            {isBralanda && (
              <button style={ac.summaryBtn} onClick={() => setCleaningModal(true)}>
                🧹 Städning idag: {cleanDoneToday}/{checkoutsToday.length}
              </button>
            )}
            <button style={ac.summaryBtn} onClick={() => setSummaryModal(true)}>📋 Kopiera dagens bokningar</button>
          </div>

          {unassigned.length > 0 && (
            <div style={s.unassignedBanner}>
              ⚠️ {unassigned.length} bokning{unassigned.length > 1 ? 'ar' : ''} saknar rumstilldelning —{' '}
              <span style={{ textDecoration: 'underline', cursor: 'pointer' }} onClick={() => setTab('bookings')}>
                tilldela nu
              </span>
            </div>
          )}

          {longTermRooms.length > 0 && (
            <div style={{ ...ac.longTermBanner, ...(isMobile ? ac.longTermBannerMobile : {}) }}>
              <strong>Långtidsboende denna vecka:</strong> {longTermRooms.map(r => r.name).join(', ')}
            </div>
          )}

          <div ref={setCalRef} style={{ ...ac.wrap, ...(isMobile ? ac.wrapMobile : {}) }}>
            <div style={{ ...ac.headerRow, minWidth: calendarBaseWidth }}>
              <div style={{ width: `${ROOM_COL_PCT}%`, flexShrink: 0, borderRight: '1px solid rgba(119,136,153,0.18)' }} />
              {days.map((d, i) => {
                const isToday = isSameDay(d, TODAY)
                return (
                  <div key={i} style={{
                    flex: 1,
                    textAlign: 'center',
                    padding: '14px 4px 12px',
                    fontSize: 12,
                    fontWeight: isToday ? 700 : 600,
                    color: isToday ? '#4f8df7' : '#5f7087',
                    background: isToday ? 'rgba(255,255,255,0.42)' : 'transparent',
                    borderLeft: i > 0 ? '1px solid rgba(119,136,153,0.18)' : 'none',
                    letterSpacing: '0.02em',
                  }}>
                    {fmtDay(d)}
                    {isToday && <div style={ac.todayDot} />}
                  </div>
                )
              })}
            </div>

            {adminDisplayRooms.map(room => {
              const pixels = getVisibleBookings(room.id).map(b => bookingToPixels(b)).filter(Boolean)
              const hk = housekeeping[`${room.id}_${todayStr}`]
              const rowHeight = isBralanda ? ROW_HEIGHT_BRALANDA : ROW_HEIGHT
              const isOutOfOrder = isBralanda && !!room.out_of_order
              const isCleaned = isBralanda && hk?.cleaning_status === 'done'
              return (
                <div key={room.id} style={{ ...ac.row, ...(isCleaned ? ac.rowCleaned : {}), ...(isOutOfOrder ? ac.rowOutOfOrder : {}), height: rowHeight, minWidth: calendarBaseWidth }}>
                  <div style={ac.roomLabel}>
                    <span style={ac.roomName}>{room.name}</span>
                    <span style={ac.roomType}>{room.type}</span>
                    {isOutOfOrder && <span style={ac.outOfOrderMini}>Ur drift</span>}
                    {isLongTermActiveInDays(room, days) && <span style={ac.longTermMini}>Långtidsboende</span>}
                    {isBralanda && (
                      <div style={ac.hkRow}>
                        <button
                          style={{ ...ac.hkPill, ...(hk?.cleaning_status === 'done' ? ac.hkPillDone : {}) }}
                          onClick={() => toggleCleaning(room.id, todayStr)}
                          title="Städat & nyckelkort finns – rummet redo för ny gäst"
                        >
                          {hk?.cleaning_status === 'done' ? '✓ Städat & kort' : 'Markera städat & kort'}
                        </button>
                      </div>
                    )}
                  </div>

                  <div style={{ position: 'relative', flex: 1, height: '100%' }}>
                    {days.map((d, i) => (
                      <React.Fragment key={i}>
                        {i > 0 && (
                          <div style={{ position: 'absolute', left: i * dayW, top: 0, bottom: 0, width: 1, background: 'rgba(119,136,153,0.18)', pointerEvents: 'none' }} />
                        )}
                        {isLongTermActive(room, d) && (
                          <div style={{ position: 'absolute', left: i * dayW, width: dayW, top: 0, bottom: 0, background: 'rgba(246,183,60,0.10)', pointerEvents: 'none' }} />
                        )}
                        {isSameDay(d, TODAY) && (
                          <div style={{ position: 'absolute', left: i * dayW, width: dayW, top: 0, bottom: 0, background: 'rgba(79,141,247,0.08)', pointerEvents: 'none' }} />
                        )}
                      </React.Fragment>
                    ))}

                    {pixels.map(({ left, width, booking, startsBeforeWeek, endsAfterWeek }) => {
                      const firstName = booking.guest_name?.split(' ')[0] || ''
                      const nights = differenceInDays(parseISO(booking.checkout), parseISO(booking.checkin))
                      const showSub = width > dayW * 1.15
                      const hasRemark = !!booking.remarks
                      const showUnpaid = isBralanda && !booking.paid
                      const showCheckinToggle = isBralanda && booking.checkin === todayStr
                      const checkinDone = showCheckinToggle && housekeeping[`${room.id}_${todayStr}`]?.checkin_done

                      return (
                        <div
                          key={booking.id}
                          onClick={() => setModal(booking)}
                          title={`${booking.guest_name} · ${nights} natt${nights !== 1 ? 'er' : ''}`}
                          style={{
                            position: 'absolute',
                            left: left + 5,
                            width: Math.max(width - 10, 22),
                            top: 10,
                            bottom: 10,
                            background: 'linear-gradient(135deg, rgba(95,140,245,0.76), rgba(121,202,255,0.64))',
                            border: '1px solid rgba(255,255,255,0.36)',
                            borderTopLeftRadius: startsBeforeWeek ? 3 : 16,
                            borderBottomLeftRadius: startsBeforeWeek ? 3 : 16,
                            borderTopRightRadius: endsAfterWeek ? 3 : 16,
                            borderBottomRightRadius: endsAfterWeek ? 3 : 16,
                            cursor: 'pointer',
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'center',
                            padding: '0 12px',
                            overflow: 'hidden',
                            userSelect: 'none',
                            boxShadow: '0 8px 22px rgba(66, 99, 170, 0.14)',
                          }}
                        >
                          {startsBeforeWeek && <div style={ac.continuesLeft} />}
                          {endsAfterWeek && <div style={ac.continuesRight} />}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, flexWrap: 'wrap' }}>
                            <span style={ac.bookingName}>{firstName}</span>
                            {hasRemark && <span style={ac.bookingRemarkDot}>●</span>}
                            {showUnpaid && <span style={ac.bookingUnpaidDot} title="Ej betald">$</span>}
                            {showCheckinToggle && (
                              <span
                                onClick={e => { e.stopPropagation(); upsertHK(room.id, todayStr, { checkin_done: !checkinDone }) }}
                                style={{ ...ac.bookingCheckinChip, ...(checkinDone ? ac.bookingCheckinChipDone : {}) }}
                                title="Klicka för att markera in-/utcheckad"
                              >
                                {checkinDone ? '✓ Incheckad' : 'Markera incheckad'}
                              </span>
                            )}
                          </div>
                          {showSub && <div style={ac.bookingSub}>{nights} natt{nights !== 1 ? 'er' : ''} · {booking.people} pers.</div>}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>

          <div style={ac.legend}>
            {[
              ['linear-gradient(135deg, rgba(95,140,245,0.76), rgba(121,202,255,0.64))', 'Bokning'],
              ['rgba(246,183,60,0.18)', 'Långtidsboende'],
              ['#f6b73c', '● Meddelande'],
              ...(isBralanda ? [['#c0392b', '$ Ej betald'], ['rgba(220,60,60,0.16)', 'Ur drift']] : []),
            ].map(([color, label]) => (
              <div key={label} style={ac.legendItem}>
                {label.startsWith('●') || label.startsWith('$')
                  ? <span style={{ color, fontSize: 11, fontWeight: 700 }}>{label[0]}</span>
                  : <div style={{ width: 26, height: 12, borderRadius: 999, background: color, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.45)' }} />}
                <span style={ac.legendText}>{label.replace(/^[●$]\s*/, '')}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'bookings' && (
        <div>
          <div style={s.previewHeader}>
            <div>
              <span style={s.previewTitle}>Bokningar</span>
              <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>Lägg till manuella bokningar eller tilldela rum.</div>
            </div>
            <button style={s.saveBtn} onClick={() => setManualBookingModal(true)}>+ Lägg till bokning</button>
          </div>

          <div style={s.searchRow}>
            <input
              type="text"
              value={bookingSearch}
              onChange={e => setBookingSearch(e.target.value)}
              placeholder="Sök gäst, rum, kategori, bokningsnr..."
              style={s.searchInput}
            />
            {bookingSearch && (
              <button style={s.searchClearBtn} onClick={() => setBookingSearch('')}>✕ Rensa</button>
            )}
          </div>

          <div style={{ ...s.statsRow, ...(isMobile ? s.statsRowMobile : {}) }}>
            <StatCard label="Totalt" value={bookings.length} />
            <StatCard label="Tilldelade rum" value={assigned.length} accent />
            <StatCard label="Ej tilldelade" value={unassigned.length} warn={unassigned.length > 0} />
          </div>

          {unassigned.length > 0 && (
            <div style={s.section}>
              <SectionTitle>Ej tilldelat rum ({unassignedFiltered.length}{searchTerm ? ` av ${unassigned.length}` : ''})</SectionTitle>
              {unassignedFiltered.length === 0 ? (
                <div style={s.emptyMuted}>Inga träffar för sökningen</div>
              ) : (
                <div style={s.tableWrap}>
                  <table style={s.table}>
                    <thead><tr>
                      <Th>Gäst</Th><Th>Incheckning</Th><Th>Utcheckning</Th>
                      <Th>Kategori (Booking.com)</Th><Th>Tilldela rum</Th>
                      {isBralanda && <Th>Betald</Th>}
                      <Th></Th>
                    </tr></thead>
                    <tbody>
                      {unassignedFiltered.map(b => (
                        <BookingRow key={b.id} b={b} rooms={rooms} onAssign={assignRoom}
                          onDelete={deleteBooking} onTogglePaid={updateBookingFields} saving={saving[b.id]}
                          onInfo={() => setModal(b)} showPaid={isBralanda} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          <div style={s.section}>
            <SectionTitle>Tilldelade ({assignedFiltered.length}{searchTerm ? ` av ${assigned.length}` : ''})</SectionTitle>
            {assignedFiltered.length === 0 ? (
              <div style={s.emptyMuted}>{searchTerm ? 'Inga träffar för sökningen' : 'Inga bokningar tilldelade ännu'}</div>
            ) : (
              <div style={s.tableWrap}>
                <table style={s.table}>
                  <thead><tr>
                    <Th>Rum</Th><Th>Gäst</Th><Th>Incheckning</Th><Th>Utcheckning</Th>
                    <Th>Kategori</Th><Th>Byt rum</Th>
                    {isBralanda && <Th>Betald</Th>}
                    <Th></Th>
                  </tr></thead>
                  <tbody>
                    {assignedFiltered.map(b => (
                      <BookingRow key={b.id} b={b} rooms={rooms} onAssign={assignRoom}
                        onDelete={deleteBooking} onTogglePaid={updateBookingFields} saving={saving[b.id]}
                        onInfo={() => setModal(b)} showRoom showPaid={isBralanda} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'import' && (
        <div>
          <div style={s.importBox}>
            <div style={s.uploadArea}>
              <div style={s.uploadIcon}>📂</div>
              <div style={s.uploadTitle}>Ladda upp Booking.com XLS-export</div>
              <div style={s.uploadSub}>Extranet → Reservationer → Exportera → Excel</div>
              <label style={s.uploadBtn}>
                Välj fil
                <input type="file" accept=".xls,.xlsx" onChange={handleXLSFile} style={{ display: 'none' }} />
              </label>
            </div>
            {importing && <p style={s.importMsg}>Läser fil...</p>}
            {importMsg && <p style={{ ...s.importMsg, color: importMsg.startsWith('✓') ? '#27ae60' : '#c0392b' }}>{importMsg}</p>}
          </div>

          {importPreview.length > 0 && (
            <div>
              <div style={s.previewHeader}>
                <span style={s.previewTitle}>{importPreview.length} bokningar hittades</span>
                <button style={s.saveBtn} onClick={saveImport} disabled={saving._import}>
                  {saving._import ? 'Sparar...' : `Importera ${importPreview.length} →`}
                </button>
              </div>
              <div style={s.tableWrap}>
                <table style={s.table}>
                  <thead><tr>
                    <Th>Bokningsnr</Th><Th>Gäst</Th><Th>Incheckning</Th><Th>Utcheckning</Th>
                    <Th>Kategori</Th><Th>Pers.</Th><Th>Multi?</Th>
                  </tr></thead>
                  <tbody>
                    {importPreview.map(b => (
                      <tr key={b.id} style={s.tr}>
                        <Td><span style={s.mono}>{b.id}</span></Td>
                        <Td>{b.guest_name}</Td>
                        <Td>{b.checkin}</Td>
                        <Td>{b.checkout}</Td>
                        <Td><span style={s.unitBadge}>{b.unit_type}</span></Td>
                        <Td>{b.people}</Td>
                        <Td>{b.multi_room_total > 1 ? <span style={s.multiBadge}>Rum {b.multi_room_index}/{b.multi_room_total}</span> : '–'}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'rooms' && (
        <div>
          <div style={s.previewHeader}>
            <div>
              <span style={s.previewTitle}>Rum</span>
              <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>Redigera rum, interna adminanteckningar och långtidsboende.</div>
            </div>
            <button style={s.saveBtn} onClick={() => setRoomModal(EMPTY_ROOM)}>+ Lägg till rum</button>
          </div>

          <div style={s.tableWrap}>
            <table style={s.table}>
              <thead><tr>
                <Th>Rum-ID</Th><Th>Namn</Th><Th>Typ</Th><Th>Kapacitet</Th>
                {isBralanda && <Th>Status</Th>}
                <Th>Adminanteckning</Th><Th>Långtidsboende</Th><Th>Aktiva bokningar</Th><Th></Th>
              </tr></thead>
              <tbody>
                {rooms.map(r => {
                  const active = bookings.filter(b => b.room_id === r.id).length
                  const longTerm = r.long_term_enabled
                  return (
                    <tr key={r.id} style={s.tr}>
                      <Td><span style={s.roomId}>{r.id}</span></Td>
                      <Td style={{ fontWeight: 500 }}>{r.name}</Td>
                      <Td>{r.type}</Td>
                      <Td>{r.capacity} pers.</Td>
                      {isBralanda && (
                        <Td>
                          {r.out_of_order
                            ? <span style={s.oooBadge}>Ur drift</span>
                            : <span style={s.emptyMuted}>–</span>}
                        </Td>
                      )}
                      <Td>
                        {r.admin_notes
                          ? <span style={s.notePreview}>{String(r.admin_notes).slice(0, 80)}{String(r.admin_notes).length > 80 ? '…' : ''}</span>
                          : <span style={s.emptyMuted}>–</span>}
                      </Td>
                      <Td>
                        {longTerm
                          ? <span style={s.longTermBadge}>Från {r.long_term_start || 'nu'}{r.long_term_end ? ` till ${r.long_term_end}` : ' · tills vidare'}</span>
                          : <span style={s.emptyMuted}>Nej</span>}
                      </Td>
                      <Td><span style={active > 0 ? s.activeBadge : s.inactiveBadge}>{active}</span></Td>
                      <Td><button style={s.editBtn} onClick={() => setRoomModal({ ...EMPTY_ROOM, ...r })}>Redigera</button></Td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function ManualBookingModal({ rooms, onClose, onSave, isBralanda, saving }) {
  const [form, setForm] = useState(EMPTY_MANUAL_BOOKING)

  function setField(field, value) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  return (
    <div style={ms.overlay} onClick={onClose}>
      <div style={{ ...ms.modal, maxWidth: 560 }} onClick={e => e.stopPropagation()}>
        <div style={ms.header}>
          <div>
            <div style={ms.roomLabel}>Lägg till bokning</div>
            <div style={ms.roomType}>Spara utan rum för att tilldela senare, eller välj rum direkt.</div>
          </div>
          <button style={ms.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div style={ms.form}>
          <label style={ms.label}>Gäst</label>
          <input
            style={ms.input}
            value={form.guest_name}
            onChange={e => setField('guest_name', e.target.value)}
            placeholder="Ex. Anna Andersson"
            autoFocus
          />

          <div style={ms.twoCols}>
            <div>
              <label style={ms.label}>Incheckning</label>
              <input style={ms.input} type="date" value={form.checkin} onChange={e => setField('checkin', e.target.value)} />
            </div>
            <div>
              <label style={ms.label}>Utcheckning</label>
              <input style={ms.input} type="date" value={form.checkout} onChange={e => setField('checkout', e.target.value)} />
            </div>
          </div>

          <div style={ms.twoCols}>
            <div>
              <label style={ms.label}>Antal gäster</label>
              <input style={ms.input} type="number" min="1" value={form.people} onChange={e => setField('people', e.target.value)} />
            </div>
            <div>
              <label style={ms.label}>Rum</label>
              <select style={ms.select} value={form.room_id} onChange={e => setField('room_id', e.target.value)}>
                <option value="">Ej tilldelat</option>
                {rooms.map(r => <option key={r.id} value={r.id}>{r.name} – {r.type}</option>)}
              </select>
            </div>
          </div>

          <label style={ms.label}>Kategori</label>
          <input
            style={ms.input}
            value={form.unit_type}
            onChange={e => setField('unit_type', e.target.value)}
            placeholder="Ex. Telefonbokning, Direktbokning, Balkongrum"
          />

          <label style={ms.label}>Pris</label>
          <input
            style={ms.input}
            value={form.price}
            onChange={e => setField('price', e.target.value)}
            placeholder="Ex. 1290 SEK"
          />

          <label style={ms.label}>Anteckning</label>
          <textarea
            style={ms.textarea}
            value={form.remarks}
            onChange={e => setField('remarks', e.target.value)}
            placeholder="Ex. Sen ankomst, betalt kontant, önskar extrasäng..."
          />

          {isBralanda && (
            <label style={ms.checkRow}>
              <input
                type="checkbox"
                checked={!!form.paid}
                onChange={e => setField('paid', e.target.checked)}
              />
              <span>Betalat för sin vistelse</span>
            </label>
          )}
        </div>

        <div style={ms.footer}>
          <button style={ms.deleteBtn} onClick={onClose}>Avbryt</button>
          <button style={ms.doneBtn} onClick={() => onSave(form)} disabled={saving}>{saving ? 'Sparar...' : 'Spara bokning'}</button>
        </div>
      </div>
    </div>
  )
}

// Textlig, kopierbar sammanfattning av vilka gäster som bor idag, per rum.
// "Idag" = incheckad senast idag och utcheckning efter idag (bor natten).
function TodaySummaryModal({ bookings, rooms, propertyLabel, today, onClose }) {
  const [copied, setCopied] = useState(false)
  const todayStr = ds(today)

  const roomName = id => rooms.find(r => r.id === id)?.name || `Rum ${id}`
  const occupied = bookings
    .filter(b => b.room_id && b.checkin && b.checkout && b.checkin <= todayStr && b.checkout > todayStr)
    .sort((a, b) => (parseInt(a.room_id, 10) || 0) - (parseInt(b.room_id, 10) || 0))

  const dateLabel = format(today, 'EEEE d MMMM yyyy', { locale: sv })
  const header = `Bokningar ${dateLabel} – ${propertyLabel}`
  const lines = occupied.map(b => `${roomName(b.room_id)}: ${b.guest_name}`)
  const text = lines.length ? `${header}\n${lines.join('\n')}` : `${header}\nInga bokningar idag`

  async function copy() {
    const ta = document.getElementById('today-summary-textarea')
    const payload = ta ? ta.value : text
    try {
      await navigator.clipboard.writeText(payload)
    } catch {
      if (ta) { ta.focus(); ta.select(); try { document.execCommand('copy') } catch { /* ignore */ } }
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div style={ms.overlay} onClick={onClose}>
      <div style={{ ...ms.modal, maxWidth: 560 }} onClick={e => e.stopPropagation()}>
        <div style={ms.header}>
          <div>
            <div style={ms.roomLabel}>Dagens bokningar</div>
            <div style={ms.roomType}>{lines.length} rum belagda idag · redigera fritt innan du kopierar</div>
          </div>
          <button style={ms.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div style={ms.form}>
          <textarea
            id="today-summary-textarea"
            style={{ ...ms.textarea, minHeight: 220, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13, lineHeight: 1.6 }}
            defaultValue={text}
          />
        </div>

        <div style={ms.footer}>
          <button style={ms.deleteBtn} onClick={onClose}>Stäng</button>
          <button style={ms.doneBtn} onClick={copy}>{copied ? '✓ Kopierat' : 'Kopiera'}</button>
        </div>
      </div>
    </div>
  )
}

function CleaningTodayModal({ checkouts, rooms, housekeeping, todayStr, onToggleCleaning, onClose }) {
  const roomName = id => rooms.find(r => r.id === id)?.name || `Rum ${id}`
  const sorted = [...checkouts]
    .filter(b => b.room_id)
    .sort((a, b) => (parseInt(a.room_id, 10) || 0) - (parseInt(b.room_id, 10) || 0))

  return (
    <div style={ms.overlay} onClick={onClose}>
      <div style={{ ...ms.modal, maxWidth: 480 }} onClick={e => e.stopPropagation()}>
        <div style={ms.header}>
          <div>
            <div style={ms.roomLabel}>Städning idag</div>
            <div style={ms.roomType}>{checkouts.length} utcheckning{checkouts.length !== 1 ? 'ar' : ''} idag</div>
          </div>
          <button style={ms.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div style={{ padding: '4px 18px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {sorted.length === 0 ? (
            <div style={s.emptyMuted}>Inga utcheckningar idag</div>
          ) : (
            sorted.map(b => {
              const hk = housekeeping[`${b.room_id}_${todayStr}`]
              const done = hk?.cleaning_status === 'done'
              return (
                <div key={b.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '8px 0', borderBottom: '1px solid #f0ede7' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#18212f' }}>{roomName(b.room_id)}</div>
                    <div style={{ fontSize: 11, color: '#8fa0b5', marginTop: 2 }}>{b.guest_name}</div>
                  </div>
                  <button
                    style={{ ...ac.hkPill, ...(done ? ac.hkPillDone : {}) }}
                    onClick={() => onToggleCleaning(b.room_id, todayStr)}
                  >
                    {done ? '✓ Städat & kort' : 'Markera städat & kort'}
                  </button>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

function RoomModal({ initial, onClose, onSave, isBralanda, saving }) {
  const [form, setForm] = useState({
    ...EMPTY_ROOM,
    ...initial,
    capacity: initial.capacity || 1,
    out_of_order: !!initial.out_of_order,
    admin_notes: initial.admin_notes || '',
    long_term_enabled: !!initial.long_term_enabled,
    long_term_start: initial.long_term_start || '',
    long_term_end: initial.long_term_end || '',
    long_term_note: initial.long_term_note || '',
  })
  const isNew = !initial?.id

  function setField(field, value) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  return (
    <div style={ms.overlay} onClick={onClose}>
      <div style={{ ...ms.modal, maxWidth: 520 }} onClick={e => e.stopPropagation()}>
        <div style={ms.header}>
          <div>
            <div style={ms.roomLabel}>{isNew ? 'Lägg till rum' : `Redigera ${initial.name}`}</div>
            <div style={ms.roomType}>Adminanteckningar syns bara här. Långtidsboende visas även för personal.</div>
          </div>
          <button style={ms.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div style={ms.form}>
          <label style={ms.label}>Rum-ID</label>
          <input
            style={ms.input}
            value={form.id}
            onChange={e => setField('id', e.target.value)}
            disabled={!isNew}
            placeholder="Ex. 17"
          />

          <label style={ms.label}>Namn</label>
          <input style={ms.input} value={form.name} onChange={e => setField('name', e.target.value)} placeholder="Ex. Rum 17" />

          <label style={ms.label}>Typ</label>
          <input style={ms.input} value={form.type || ''} onChange={e => setField('type', e.target.value)} placeholder="Ex. Studio med kök" />

          <label style={ms.label}>Kapacitet</label>
          <input style={ms.input} type="number" min="1" value={form.capacity} onChange={e => setField('capacity', e.target.value)} />

          {isBralanda && (
            <label style={ms.checkRow}>
              <input
                type="checkbox"
                checked={!!form.out_of_order}
                onChange={e => setField('out_of_order', e.target.checked)}
              />
              <span>Ur drift (kan inte användas alls just nu)</span>
            </label>
          )}

          <label style={ms.label}>Adminanteckning på rummet</label>
          <textarea
            style={ms.textarea}
            value={form.admin_notes || ''}
            onChange={e => setField('admin_notes', e.target.value)}
            placeholder="Syns bara för admin. Ex. element låter ibland, undvik barnfamiljer, trasig lampa..."
          />

          <label style={ms.checkRow}>
            <input
              type="checkbox"
              checked={!!form.long_term_enabled}
              onChange={e => setField('long_term_enabled', e.target.checked)}
            />
            <span>Markera som långtidsboende</span>
          </label>

          {form.long_term_enabled && (
            <div style={ms.longTermBox}>
              <div style={ms.twoCols}>
                <div>
                  <label style={ms.label}>Från datum</label>
                  <input style={ms.input} type="date" value={form.long_term_start || ''} onChange={e => setField('long_term_start', e.target.value)} />
                </div>
                <div>
                  <label style={ms.label}>Till datum</label>
                  <input style={ms.input} type="date" value={form.long_term_end || ''} onChange={e => setField('long_term_end', e.target.value)} />
                </div>
              </div>
              <div style={ms.hint}>Lämna “Till datum” tomt om det gäller tills vidare.</div>
              <label style={ms.label}>Text till personalen</label>
              <textarea
                style={ms.textarea}
                value={form.long_term_note || ''}
                onChange={e => setField('long_term_note', e.target.value)}
                placeholder="Syns för personal. Ex. Långtidsboende – stör ej utan avtal."
              />
            </div>
          )}
        </div>

        <div style={ms.footer}>
          <button style={ms.deleteBtn} onClick={onClose}>Avbryt</button>
          <button style={ms.doneBtn} onClick={() => onSave(form)} disabled={saving}>{saving ? 'Sparar...' : 'Spara rum'}</button>
        </div>
      </div>
    </div>
  )
}

// ── DETAIL MODAL ──
function DetailModal({ booking: b, rooms, bookings, onClose, onAssign, onDelete, onUpdate, isBralanda, saving }) {
  const room = rooms.find(r => r.id === b.room_id)
  const nights = differenceInDays(parseISO(b.checkout), parseISO(b.checkin))
  const candidates = extractRoomCandidates(b.unit_type)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(null)

  const siblings = b.multi_room_original_id
    ? bookings.filter(x => x.multi_room_original_id === b.multi_room_original_id && x.id !== b.id)
    : []

  function startEditing() {
    setForm({
      guest_name: b.guest_name || '',
      checkin: b.checkin || '',
      checkout: b.checkout || '',
      people: b.people || 1,
      unit_type: b.unit_type || '',
      price: b.price || '',
      remarks: b.remarks || '',
    })
    setEditing(true)
  }

  function setField(field, value) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  function saveEdits() {
    const guestName = String(form.guest_name || '').trim()
    const checkin = String(form.checkin || '').trim()
    const checkout = String(form.checkout || '').trim()
    if (!guestName || !checkin || !checkout) { alert('Gäst, incheckning och utcheckning krävs.'); return }
    if (checkout <= checkin) { alert('Utcheckning måste vara efter incheckning.'); return }

    onUpdate(b.id, {
      guest_name: guestName,
      checkin,
      checkout,
      people: parseInt(form.people, 10) || 1,
      unit_type: String(form.unit_type || '').trim(),
      price: String(form.price || '').trim() || null,
      remarks: String(form.remarks || '').trim() || null,
    })
    setEditing(false)
  }

  return (
    <div style={ms.overlay} onClick={onClose}>
      <div style={ms.modal} onClick={e => e.stopPropagation()}>
        <div style={ms.header}>
          <div>
            <div style={ms.roomLabel}>{room ? room.name : 'Inget rum tilldelat'}</div>
            <div style={ms.roomType}>{room?.type || b.unit_type}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {isBralanda && !editing && (
              <button style={ms.editIconBtn} onClick={startEditing}>Redigera</button>
            )}
            <button style={ms.closeBtn} onClick={onClose}>✕</button>
          </div>
        </div>

        {isBralanda && editing ? (
          <div style={ms.form}>
            <label style={ms.label}>Gäst</label>
            <input style={ms.input} value={form.guest_name} onChange={e => setField('guest_name', e.target.value)} />

            <div style={ms.twoCols}>
              <div>
                <label style={ms.label}>Incheckning</label>
                <input style={ms.input} type="date" value={form.checkin} onChange={e => setField('checkin', e.target.value)} />
              </div>
              <div>
                <label style={ms.label}>Utcheckning</label>
                <input style={ms.input} type="date" value={form.checkout} onChange={e => setField('checkout', e.target.value)} />
              </div>
            </div>

            <div style={ms.twoCols}>
              <div>
                <label style={ms.label}>Antal gäster</label>
                <input style={ms.input} type="number" min="1" value={form.people} onChange={e => setField('people', e.target.value)} />
              </div>
              <div>
                <label style={ms.label}>Pris</label>
                <input style={ms.input} value={form.price} onChange={e => setField('price', e.target.value)} />
              </div>
            </div>

            <label style={ms.label}>Rumskategori</label>
            <input style={ms.input} value={form.unit_type} onChange={e => setField('unit_type', e.target.value)} />

            <label style={ms.label}>Anteckning</label>
            <textarea style={ms.textarea} value={form.remarks} onChange={e => setField('remarks', e.target.value)} />

            <div style={ms.editActions}>
              <button style={ms.deleteBtn} onClick={() => setEditing(false)}>Avbryt</button>
              <button style={ms.doneBtn} onClick={saveEdits} disabled={saving}>{saving ? 'Sparar...' : 'Spara ändringar'}</button>
            </div>
          </div>
        ) : (
          <>
            <div style={ms.guestName}>{b.guest_name}</div>

            <div style={ms.infoGrid}>
              <InfoRow label="Incheckning"   value={fmtFull(b.checkin)} />
              <InfoRow label="Utcheckning"   value={fmtFull(b.checkout)} />
              <InfoRow label="Nätter"        value={nights} />
              <InfoRow label="Antal gäster"  value={`${b.people} person${b.people > 1 ? 'er' : ''}`} />
              <InfoRow label="Bokningsnr"    value={`#${b.multi_room_original_id || b.id}`} />
              <InfoRow label="Rumskategori"  value={b.unit_type} />
              {b.price && <InfoRow label="Pris" value={b.price} />}
              {b.multi_room_total > 1 && (
                <InfoRow label="Multibokning" value={`Rum ${b.multi_room_index} av ${b.multi_room_total}`} accent />
              )}
            </div>
          </>
        )}

        {isBralanda && !editing && (
          <div style={ms.assignSection}>
            <label style={ms.paidRow}>
              <input
                type="checkbox"
                checked={!!b.paid}
                disabled={saving}
                onChange={() => onUpdate(b.id, { paid: !b.paid })}
              />
              <span>Betalat för sin vistelse</span>
            </label>
          </div>
        )}

        {!editing && siblings.length > 0 && (
          <div style={ms.siblings}>
            <div style={ms.siblingsLabel}>Övriga rum i samma bokning</div>
            {siblings.map(sb => {
              const sr = rooms.find(r => r.id === sb.room_id)
              return (
                <div key={sb.id} style={ms.siblingRow}>
                  <span style={ms.siblingUnit}>{sb.unit_type}</span>
                  <span style={ms.siblingRoom}>{sr ? sr.name : '– ej tilldelat'}</span>
                </div>
              )
            })}
          </div>
        )}

        {!editing && b.remarks && (
          <div style={ms.remarks}>
            <div style={ms.remarksLabel}>Meddelande från gäst</div>
            <div style={ms.remarksText}>{b.remarks}</div>
          </div>
        )}

        {!editing && (
          <div style={ms.assignSection}>
            <div style={ms.assignLabel}>Tilldela rum</div>
            <select
              value={b.room_id || ''}
              onChange={e => onAssign(b.id, e.target.value)}
              style={ms.select}
              disabled={saving}
            >
              <option value="">– Välj rum –</option>
              {candidates.length > 0 && (
                <optgroup label="Förslag (från kategori)">
                  {candidates.map(c => {
                    const r = rooms.find(r => r.id === c)
                    return r ? <option key={c} value={c}>{r.name} ({r.type})</option> : null
                  })}
                </optgroup>
              )}
              <optgroup label="Alla rum">
                {rooms.map(r => <option key={r.id} value={r.id}>{r.name} – {r.type}</option>)}
              </optgroup>
            </select>
          </div>
        )}

        {!editing && (
          <div style={ms.footer}>
            <button style={ms.deleteBtn} onClick={() => onDelete(b.id)}>Ta bort bokning</button>
            <button style={ms.doneBtn} onClick={onClose}>Stäng</button>
          </div>
        )}
      </div>
    </div>
  )
}

function InfoRow({ label, value, accent }) {
  return (
    <div style={ms.infoRow}>
      <span style={ms.infoLabel}>{label}</span>
      <span style={{ ...ms.infoValue, ...(accent ? { color: '#0C447C', fontWeight: 600 } : {}) }}>{value}</span>
    </div>
  )
}

function BookingRow({ b, rooms, onAssign, onDelete, onTogglePaid, saving, showRoom, showPaid, onInfo }) {
  const room = rooms.find(r => r.id === b.room_id)
  const candidates = extractRoomCandidates(b.unit_type)
  return (
    <tr style={s.tr}>
      {showRoom && (
        <td style={s.td}>
          {room ? <span style={s.roomBadge}>{room.name}</span> : <span style={{ color: '#bbb' }}>–</span>}
        </td>
      )}
      <td style={s.td}>
        <div style={{ fontWeight: 500, fontSize: 13 }}>{b.guest_name}</div>
        <div style={{ fontSize: 11, color: '#aaa' }}>#{b.multi_room_original_id || b.id}
          {b.multi_room_total > 1 && <span style={s.multiBadge}> Rum {b.multi_room_index}/{b.multi_room_total}</span>}
        </div>
      </td>
      <td style={s.td}>{b.checkin}</td>
      <td style={s.td}>{b.checkout}</td>
      <td style={s.td}><span style={s.unitBadge}>{b.unit_type}</span></td>
      <td style={s.td}>
        <select value={b.room_id || ''} onChange={e => onAssign(b.id, e.target.value)} style={s.select} disabled={saving}>
          <option value="">– Välj rum –</option>
          {candidates.length > 0 && (
            <optgroup label="Förslag">
              {candidates.map(c => { const r = rooms.find(r => r.id === c); return r ? <option key={c} value={c}>{r.name}</option> : null })}
            </optgroup>
          )}
          <optgroup label="Alla rum">
            {rooms.map(r => <option key={r.id} value={r.id}>{r.name} – {r.type}</option>)}
          </optgroup>
        </select>
      </td>
      {showPaid && (
        <td style={s.td}>
          <label style={s.paidCheckLabel} onClick={e => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={!!b.paid}
              disabled={saving}
              onChange={() => onTogglePaid(b.id, { paid: !b.paid })}
            />
            {b.paid ? 'Betald' : 'Obetald'}
          </label>
        </td>
      )}
      <td style={s.td}>
        <button style={s.infoBtn} onClick={onInfo}>ℹ</button>
        <button style={s.deleteBtn} onClick={() => onDelete(b.id)}>✕</button>
      </td>
    </tr>
  )
}

function TabBtn({ label, active, onClick, badge }) {
  return (
    <button style={{ ...s.tabBtn, ...(typeof window !== 'undefined' && window.innerWidth <= 760 ? s.tabBtnMobile : {}), ...(active ? s.tabBtnActive : {}) }} onClick={onClick}>
      {label}
      {badge ? <span style={s.tabBadge}>{badge}</span> : null}
    </button>
  )
}
function StatCard({ label, value, accent, warn }) {
  return (
    <div style={{ ...s.statCard, ...(accent ? s.statAccent : {}), ...(warn ? s.statWarn : {}) }}>
      <div style={s.statLabel}>{label}</div>
      <div style={s.statVal}>{value}</div>
    </div>
  )
}
function SectionTitle({ children }) { return <div style={s.sectionTitle}>{children}</div> }
const Th = ({ children }) => <th style={s.th}>{children}</th>
const Td = ({ children, style }) => <td style={{ ...s.td, ...style }}>{children}</td>

const s = {
  page: { maxWidth: 1180, margin: '0 auto', padding: '0 16px 80px', fontFamily: 'system-ui, sans-serif', overflowX: 'hidden' },
  pageMobile: { padding: '0 14px 72px' },
  topbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 0 12px', borderBottom: '1px solid #eee', marginBottom: 20, flexWrap: 'wrap', gap: 8 },
  topbarMobile: { alignItems: 'flex-start', flexDirection: 'column', gap: 12, paddingTop: 18 },
  hotelName: { fontSize: 16, fontWeight: 600, color: '#1a1a1a', marginRight: 8 },
  hotelNameMobile: { fontSize: 24, display: 'inline-block', marginBottom: 6 },
  adminBadge: { fontSize: 10, fontWeight: 600, background: '#1a1a1a', color: '#fff', padding: '2px 7px', borderRadius: 20 },
  propSwitch: { display: 'inline-flex', gap: 4, background: '#f2f1ec', borderRadius: 999, padding: 4, border: '1px solid #e6e3dc', width: 'fit-content' },
  propSwitchMobile: { width: '100%' },
  propBtn: { padding: '6px 14px', border: 'none', borderRadius: 999, background: 'transparent', fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#777' },
  propBtnActive: { background: '#fff', color: '#1a1a1a', boxShadow: '0 1px 4px rgba(0,0,0,0.12)' },
  tabs: { display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' },
  tabsMobile: { width: '100%', gap: 8 },
  tabBtn: { padding: '6px 14px', border: '1px solid #ddd', borderRadius: 7, background: 'transparent', fontSize: 13, cursor: 'pointer', color: '#666', position: 'relative' },
  tabBtnMobile: { padding: '10px 14px', fontSize: 15, borderRadius: 10 },
  tabBtnActive: { background: '#1a1a1a', color: '#fff', borderColor: '#1a1a1a' },
  tabBadge: { position: 'absolute', top: -6, right: -6, background: '#e74c3c', color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 10, minWidth: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' },
  signoutBtn: { fontSize: 12, padding: '5px 10px', border: '1px solid #ddd', borderRadius: 6, background: 'transparent', cursor: 'pointer', color: '#888', marginLeft: 8 },
  signoutBtnMobile: { marginLeft: 0, padding: '10px 14px', fontSize: 15, borderRadius: 10 },
  weekNav: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  weekLabel: { fontSize: 14, fontWeight: 500, color: '#333' },
  navBtn: { fontSize: 13, padding: '5px 12px', border: '1px solid #ddd', borderRadius: 6, background: 'transparent', cursor: 'pointer', color: '#555' },
  unassignedBanner: { background: '#fdf8f2', border: '1px solid #f0d9b0', borderRadius: 7, padding: '8px 12px', fontSize: 13, color: '#8a6020', marginBottom: 12 },
  longTermBanner: { background: '#fff8dc', border: '1px solid #f3db86', borderRadius: 7, padding: '8px 12px', fontSize: 13, color: '#7a5a10', marginBottom: 12 },
  calWrap: { overflowX: 'auto' },
  calTable: { borderCollapse: 'collapse', width: '100%', minWidth: 700 },
  roomTh: { fontSize: 11, fontWeight: 600, color: '#888', padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid #eee', background: '#fafaf8', minWidth: 116 },
  dayTh: { fontSize: 11, fontWeight: 500, color: '#888', padding: '6px 4px', textAlign: 'center', borderBottom: '1px solid #eee', background: '#fafaf8', minWidth: 88 },
  todayTh: { color: '#1a1a1a', fontWeight: 700 },
  roomCell: { padding: '6px 8px', borderBottom: '1px solid #f0ede7', borderRight: '1px solid #f0ede7', background: '#fafaf8', verticalAlign: 'middle', whiteSpace: 'nowrap' },
  roomNum: { display: 'block', fontSize: 12, fontWeight: 600, color: '#333' },
  roomType: { display: 'block', fontSize: 10, color: '#aaa' },
  longTermMini: { display: 'inline-block', marginTop: 4, background: '#fff3cf', color: '#7a5a10', fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 20 },
  calCell: { border: '1px solid #f0ede7', height: 42, verticalAlign: 'middle', padding: 0, position: 'relative' },
  todayCell: { background: 'rgba(55, 138, 221, 0.04)' },
  longTermCell: { background: 'linear-gradient(135deg, rgba(255, 248, 220, 0.9), rgba(255, 255, 255, 0.6))' },
  longTermCellText: { fontSize: 9, fontWeight: 700, color: '#9a7118', paddingLeft: 5 },
  legend: { display: 'flex', gap: 14, marginTop: 12, flexWrap: 'wrap' },
  legendItem: { display: 'flex', alignItems: 'center', gap: 5 },
  statsRow: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 24 },
  statsRowMobile: { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 },
  statCard: { background: '#f7f6f2', borderRadius: 8, padding: '14px 16px' },
  statAccent: { background: '#eaf3de' },
  statWarn: { background: '#fdf8f2' },
  statLabel: { fontSize: 11, color: '#888', marginBottom: 4 },
  statVal: { fontSize: 26, fontWeight: 700, color: '#1a1a1a' },
  section: { marginBottom: 28 },
  sectionTitle: { fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#888', marginBottom: 10 },
  tableWrap: { overflowX: 'auto', borderRadius: 8, border: '1px solid #e8e5df' },
  table: { borderCollapse: 'collapse', width: '100%', minWidth: 760, fontSize: 13 },
  th: { padding: '8px 12px', background: '#fafaf8', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#888', borderBottom: '1px solid #eee', whiteSpace: 'nowrap' },
  tr: { borderBottom: '1px solid #f0ede7' },
  td: { padding: '10px 12px', verticalAlign: 'middle', color: '#333' },
  select: { fontSize: 13, padding: '5px 8px', border: '1px solid #ddd', borderRadius: 6, background: '#fff', cursor: 'pointer', minWidth: 160 },
  infoBtn: { fontSize: 13, color: '#888', background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 5px', marginRight: 2 },
  deleteBtn: { fontSize: 12, color: '#ccc', background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 6px' },
  editBtn: { fontSize: 12, color: '#1a1a1a', background: '#fff', border: '1px solid #ddd', borderRadius: 6, cursor: 'pointer', padding: '5px 9px' },
  roomBadge: { background: '#EAF3DE', color: '#27500A', fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 20 },
  unitBadge: { background: '#f0ede7', color: '#777', fontSize: 11, padding: '2px 7px', borderRadius: 4 },
  multiBadge: { background: '#E6F1FB', color: '#0C447C', fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 10, marginLeft: 4 },
  mono: { fontFamily: 'monospace', fontSize: 12, color: '#888' },
  roomId: { fontFamily: 'monospace', fontWeight: 700, fontSize: 14, color: '#1a1a1a' },
  activeBadge: { background: '#EAF3DE', color: '#27500A', fontSize: 12, fontWeight: 600, padding: '2px 10px', borderRadius: 20 },
  inactiveBadge: { color: '#ccc', fontSize: 12 },
  oooBadge: { background: '#FBE1E1', color: '#a12727', fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 20, whiteSpace: 'nowrap' },
  paidCheckLabel: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#555', cursor: 'pointer', whiteSpace: 'nowrap' },
  notePreview: { fontSize: 12, color: '#555', lineHeight: 1.4 },
  emptyMuted: { color: '#bbb', fontSize: 12 },
  longTermBadge: { background: '#fff3cf', color: '#7a5a10', fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 20, whiteSpace: 'nowrap' },
  importBox: { border: '1px solid #e8e5df', borderRadius: 10, padding: 24, marginBottom: 20, background: '#fafaf8' },
  uploadArea: { textAlign: 'center', padding: '20px 0' },
  uploadIcon: { fontSize: 40, marginBottom: 10 },
  uploadTitle: { fontSize: 15, fontWeight: 600, color: '#1a1a1a', marginBottom: 4 },
  uploadSub: { fontSize: 12, color: '#aaa', marginBottom: 14 },
  uploadBtn: { display: 'inline-block', padding: '8px 20px', background: '#1a1a1a', color: '#fff', borderRadius: 7, fontSize: 13, fontWeight: 500, cursor: 'pointer' },
  importMsg: { textAlign: 'center', fontSize: 13, marginTop: 10, color: '#888' },
  previewHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 12, flexWrap: 'wrap' },
  previewTitle: { fontSize: 14, fontWeight: 600 },
  searchRow: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 },
  searchInput: { flex: 1, maxWidth: 360, fontSize: 13, padding: '8px 12px', border: '1px solid #ddd', borderRadius: 7, background: '#fff' },
  searchClearBtn: { fontSize: 12, padding: '7px 10px', border: '1px solid #ddd', borderRadius: 6, background: 'transparent', cursor: 'pointer', color: '#888' },
  saveBtn: { padding: '8px 16px', background: '#1a1a1a', color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 500, cursor: 'pointer' },
}


const ac = {
  viewHeader: {
    ...glassPanel,
    borderRadius: 28,
    padding: '22px 24px',
    marginBottom: 18,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 16,
    flexWrap: 'wrap',
    background: 'rgba(255,255,255,0.68)',
  },
  viewHeaderMobile: { borderRadius: 26, padding: '22px 20px', alignItems: 'flex-start', flexDirection: 'column', gap: 16 },
  titleWrap: { textAlign: 'center', flex: 1, minWidth: 280 },
  titleWrapMobile: { textAlign: 'left', minWidth: 0, width: '100%', order: -1 },
  kicker: { fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#8fa0b5', fontWeight: 700, marginBottom: 8 },
  title: { fontSize: 32, fontWeight: 750, color: '#18212f', letterSpacing: '-0.03em' },
  titleMobile: { fontSize: 30, lineHeight: 1.05 },
  navBtn: {
    fontSize: 14,
    padding: '11px 18px',
    border: '1px solid rgba(255,255,255,0.68)',
    borderRadius: 999,
    background: 'rgba(255,255,255,0.62)',
    cursor: 'pointer',
    color: '#18212f',
    fontWeight: 600,
    boxShadow: '0 8px 24px rgba(86, 104, 140, 0.10)',
  },
  navBtnMobile: { padding: '10px 14px', fontSize: 13 },
  summaryBar: { display: 'flex', justifyContent: 'flex-end', margin: '-4px 0 14px' },
  summaryBtn: {
    fontSize: 13,
    fontWeight: 600,
    padding: '10px 16px',
    border: '1px solid rgba(255,255,255,0.68)',
    borderRadius: 999,
    background: 'rgba(255,255,255,0.62)',
    cursor: 'pointer',
    color: '#18212f',
    boxShadow: '0 8px 24px rgba(86, 104, 140, 0.10)',
  },
  longTermBanner: {
    ...glassPanel,
    background: 'rgba(255,248,220,0.68)',
    borderRadius: 18,
    padding: '11px 14px',
    margin: '-4px 0 16px',
    color: '#8a6416',
    fontSize: 13,
    fontWeight: 600,
  },
  longTermBannerMobile: { fontSize: 12, lineHeight: 1.45, margin: '-4px 0 14px' },
  wrap: { ...glassPanel, borderRadius: 28, overflowX: 'auto', overflowY: 'hidden', width: '100%', background: 'rgba(255,255,255,0.64)', WebkitOverflowScrolling: 'touch' },
  wrapMobile: { borderRadius: 24 },
  headerRow: { display: 'flex', borderBottom: '1px solid rgba(119,136,153,0.28)', background: 'rgba(255,255,255,0.28)' },
  todayDot: { width: 6, height: 6, borderRadius: '50%', background: '#4f8df7', margin: '6px auto 0', boxShadow: '0 0 0 5px rgba(79,141,247,0.12)' },
  row: { display: 'flex', height: ROW_HEIGHT, borderBottom: '1px solid rgba(119,136,153,0.18)', background: 'rgba(255,255,255,0.28)', position: 'relative' },
  rowOutOfOrder: { background: 'rgba(251,225,225,0.55)' },
  rowCleaned: {
    background: 'repeating-linear-gradient(135deg, rgba(206,238,222,0.5) 0px, rgba(206,238,222,0.5) 12px, rgba(255,255,255,0.4) 12px, rgba(255,255,255,0.4) 24px)',
  },
  outOfOrderMini: {
    display: 'inline-block',
    marginTop: 6,
    padding: '3px 7px',
    borderRadius: 999,
    background: 'rgba(220,60,60,0.16)',
    color: '#a12727',
    fontSize: 10,
    fontWeight: 800,
    whiteSpace: 'nowrap',
  },
  hkRow: { display: 'flex', gap: 4, marginTop: 5, flexWrap: 'wrap' },
  hkPill: {
    fontSize: 9,
    fontWeight: 700,
    padding: '3px 6px',
    borderRadius: 999,
    border: '1px solid rgba(119,136,153,0.28)',
    background: 'rgba(255,255,255,0.7)',
    color: '#5f7087',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  hkPillDone: { background: 'rgba(55,184,122,0.16)', color: '#1f7a4d', borderColor: 'rgba(55,184,122,0.3)' },
  roomLabel: {
    width: `${ROOM_COL_PCT}%`,
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    padding: '0 14px',
    borderRight: '1px solid rgba(119,136,153,0.18)',
    background: 'rgba(255,255,255,0.34)',
  },
  roomName: { fontSize: 13, fontWeight: 700, color: '#18212f' },
  roomType: { fontSize: 11, color: '#8fa0b5', marginTop: 3 },
  longTermMini: {
    display: 'inline-block',
    marginTop: 6,
    padding: '3px 7px',
    borderRadius: 999,
    background: 'rgba(246,183,60,0.18)',
    color: '#9a7118',
    fontSize: 10,
    fontWeight: 800,
    whiteSpace: 'nowrap',
  },
  bookingName: { fontSize: 12, fontWeight: 700, color: '#ffffff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  bookingSub: { fontSize: 10, color: 'rgba(255,255,255,0.86)', marginTop: 2, whiteSpace: 'nowrap' },
  bookingRemarkDot: { fontSize: 9, color: '#fff3b0', flexShrink: 0 },
  bookingUnpaidDot: { fontSize: 10, fontWeight: 800, color: '#ffd9d9', flexShrink: 0 },
  bookingCheckinChip: {
    fontSize: 9,
    fontWeight: 700,
    padding: '2px 6px',
    borderRadius: 999,
    background: 'rgba(255,255,255,0.32)',
    color: '#fff',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  },
  bookingCheckinChipDone: { background: 'rgba(255,255,255,0.9)', color: '#1f7a4d' },
  continuesLeft: {
    position: 'absolute',
    left: 0,
    top: 7,
    bottom: 7,
    width: 3,
    background: 'rgba(255,255,255,0.82)',
    borderRadius: 999,
    pointerEvents: 'none',
  },
  continuesRight: {
    position: 'absolute',
    right: 0,
    top: 7,
    bottom: 7,
    width: 3,
    background: 'rgba(255,255,255,0.82)',
    borderRadius: 999,
    pointerEvents: 'none',
  },
  legend: { display: 'flex', gap: 16, marginTop: 16, flexWrap: 'wrap', alignItems: 'center' },
  legendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '9px 12px',
    borderRadius: 999,
    background: 'rgba(255,255,255,0.56)',
    border: '1px solid rgba(255,255,255,0.64)',
    boxShadow: '0 8px 24px rgba(86,104,140,0.10)',
  },
  legendText: { fontSize: 12, color: '#5f7087', fontWeight: 600 },
}

const ms = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 },
  modal: { background: '#fff', borderRadius: 14, width: '100%', maxWidth: 460, boxShadow: '0 8px 40px rgba(0,0,0,0.18)', overflow: 'hidden', maxHeight: '90vh', overflowY: 'auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '18px 18px 10px', borderBottom: '1px solid #f0ede7' },
  roomLabel: { fontSize: 18, fontWeight: 700, color: '#1a1a1a' },
  roomType: { fontSize: 12, color: '#aaa', marginTop: 2 },
  closeBtn: { background: 'transparent', border: 'none', fontSize: 16, color: '#bbb', cursor: 'pointer', padding: 4 },
  guestName: { fontSize: 15, fontWeight: 600, color: '#333', padding: '12px 18px 4px' },
  infoGrid: { padding: '4px 18px 12px' },
  infoRow: { display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid #f5f4f0' },
  infoLabel: { fontSize: 12, color: '#999' },
  infoValue: { fontSize: 12, color: '#333', fontWeight: 500, textAlign: 'right', maxWidth: '60%' },
  siblings: { margin: '0 18px 10px', background: '#f0f7ff', borderRadius: 7, padding: '8px 12px' },
  siblingsLabel: { fontSize: 11, fontWeight: 600, color: '#0C447C', marginBottom: 6 },
  siblingRow: { display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0', color: '#555' },
  siblingUnit: { color: '#888' },
  siblingRoom: { fontWeight: 500, color: '#1a1a1a' },
  remarks: { margin: '0 18px 12px', background: '#fdf8f2', borderRadius: 7, padding: '10px 12px' },
  remarksLabel: { fontSize: 11, fontWeight: 600, color: '#a0845c', marginBottom: 4 },
  remarksText: { fontSize: 12, color: '#666', lineHeight: 1.5 },
  assignSection: { padding: '0 18px 12px' },
  assignLabel: { fontSize: 11, fontWeight: 600, color: '#888', marginBottom: 6 },
  select: { width: '100%', fontSize: 13, padding: '7px 10px', border: '1px solid #ddd', borderRadius: 7, background: '#fff', cursor: 'pointer' },
  form: { padding: '14px 18px 6px' },
  label: { display: 'block', fontSize: 11, fontWeight: 700, color: '#888', margin: '10px 0 5px', textTransform: 'uppercase', letterSpacing: '0.04em' },
  input: { width: '100%', boxSizing: 'border-box', fontSize: 13, padding: '8px 10px', border: '1px solid #ddd', borderRadius: 7, background: '#fff' },
  textarea: { width: '100%', boxSizing: 'border-box', minHeight: 72, resize: 'vertical', fontSize: 13, padding: '8px 10px', border: '1px solid #ddd', borderRadius: 7, background: '#fff', fontFamily: 'inherit' },
  checkRow: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 14, fontSize: 13, fontWeight: 600, color: '#333' },
  longTermBox: { marginTop: 10, padding: 12, background: '#fff8dc', border: '1px solid #f3db86', borderRadius: 9 },
  twoCols: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 },
  hint: { fontSize: 11, color: '#8a6020', margin: '7px 0 8px' },
  footer: { display: 'flex', justifyContent: 'space-between', padding: '12px 18px 18px', borderTop: '1px solid #f0ede7', gap: 8 },
  deleteBtn: { fontSize: 12, padding: '6px 12px', border: '1px solid #f0c0c0', borderRadius: 7, background: 'transparent', cursor: 'pointer', color: '#c0392b' },
  doneBtn: { fontSize: 13, padding: '7px 18px', border: 'none', borderRadius: 7, background: '#1a1a1a', color: '#fff', cursor: 'pointer', fontWeight: 500 },
  editIconBtn: { fontSize: 11, fontWeight: 600, padding: '5px 10px', border: '1px solid #ddd', borderRadius: 6, background: '#fff', cursor: 'pointer', color: '#1a1a1a' },
  editActions: { display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '10px 0 4px' },
  paidRow: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: '#333', cursor: 'pointer' },
}
