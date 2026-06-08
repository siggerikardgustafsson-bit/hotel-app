import React, { useEffect, useState } from 'react'
import { supabase, signOut } from '../lib/supabase'
import { parseBookingXLS, extractRoomCandidates } from '../lib/parseXLS'
import { format, addDays, startOfWeek, isSameDay, parseISO, differenceInDays } from 'date-fns'
import { sv } from 'date-fns/locale'

const TODAY = new Date()
TODAY.setHours(0,0,0,0)

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

const EMPTY_ROOM = {
  id: '',
  name: '',
  type: '',
  capacity: 1,
  admin_notes: '',
  long_term_enabled: false,
  long_term_start: '',
  long_term_end: '',
  long_term_note: '',
}

const NUM_DAYS = 7
const ROW_HEIGHT = 68
const ROOM_COL_PCT = 13

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
  const [weekStart, setWeekStart] = useState(() => startOfWeek(TODAY, { weekStartsOn: 1 }))
  const [housekeeping, setHousekeeping] = useState({})
  const [calRef, setCalRef] = useState(null)
  const [calWidth, setCalWidth] = useState(900)

  useEffect(() => {
    loadRooms(); loadBookings(); fetchHousekeeping()
  }, [])

  useEffect(() => {
    if (!calRef) return
    const obs = new ResizeObserver(entries => setCalWidth(entries[0].contentRect.width))
    obs.observe(calRef)
    return () => obs.disconnect()
  }, [calRef])

  async function loadRooms() {
    const { data } = await supabase.from('rooms').select('*')
    setRooms(sortRooms(data || []))
  }
  async function loadBookings() {
    const { data } = await supabase.from('bookings').select('*').order('checkin')
    setBookings(data || [])
  }
  async function fetchHousekeeping() {
    const { data } = await supabase.from('housekeeping').select('*')
    const map = {}
    ;(data || []).forEach(h => { map[`${h.room_id}_${h.date}`] = h })
    setHousekeeping(map)
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

    const ids = [...new Set(importPreview.map(b => b.id).filter(Boolean))]

    // Hämta befintliga bokningar först så en ny XLS-uppladdning uppdaterar samma bokning
    // men inte råkar nollställa ett rum som admin redan har valt manuellt.
    const { data: existingRows, error: fetchError } = await supabase
      .from('bookings')
      .select('id, room_id')
      .in('id', ids)

    if (fetchError) {
      setImportMsg('Fel vid kontroll av befintliga bokningar: ' + fetchError.message)
      setSaving({})
      return
    }

    const existingById = new Map((existingRows || []).map(row => [row.id, row]))
    const merged = importPreview.map(incoming => {
      const existing = existingById.get(incoming.id)

      return {
        ...incoming,

        // Om parsern kan föreslå ett rum använder vi det.
        // Annars behåller vi befintlig manuell rumstilldelning vid återimport.
        room_id: incoming.room_id || existing?.room_id || null,
      }
    })

    const { error } = await supabase
      .from('bookings')
      .upsert(merged, { onConflict: 'id' })

    if (error) {
      setImportMsg('Fel vid sparande: ' + error.message)
    } else {
      const existingCount = merged.filter(b => existingById.has(b.id)).length
      const newCount = merged.length - existingCount

      setImportMsg(`✓ ${newCount} nya, ${existingCount} uppdaterade`)
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
      admin_notes: String(form.admin_notes || '').trim() || null,
      long_term_enabled: !!form.long_term_enabled,
      long_term_start: form.long_term_enabled && form.long_term_start ? form.long_term_start : null,
      long_term_end: form.long_term_enabled && form.long_term_end ? form.long_term_end : null,
      long_term_note: form.long_term_enabled && form.long_term_note ? String(form.long_term_note).trim() : null,
      updated_at: new Date().toISOString(),
    }

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

  function getSegment(roomId, date) {
    const d = typeof date === 'string' ? parseISO(date) : date
    for (const b of bookings) {
      if (b.room_id !== roomId || !b.checkin || !b.checkout) continue
      const ci = parseISO(b.checkin), co = parseISO(b.checkout)
      if (isSameDay(ci, d)) return { type: 'checkin', booking: b }
      if (isSameDay(co, d)) return { type: 'checkout', booking: b }
      if (d > ci && d < co) return { type: 'stay', booking: b }
    }
    return { type: 'free', booking: null }
  }

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const unassigned = bookings.filter(b => !b.room_id)
  const assigned   = bookings.filter(b => b.room_id)
  const longTermRooms = rooms.filter(r => isLongTermActiveInDays(r, days))
  const adminDisplayRooms = [...rooms].sort((a, b) => {
    const aLong = isLongTermActiveInDays(a, days) ? 1 : 0
    const bLong = isLongTermActiveInDays(b, days) ? 1 : 0
    if (aLong !== bLong) return aLong - bLong
    return parseInt(a.id, 10) - parseInt(b.id, 10)
  })

  const gridW = calWidth * (1 - ROOM_COL_PCT / 100)
  const dayW = gridW / NUM_DAYS
  const half = dayW / 2

  function getVisibleBookings(roomId) {
    const weekEnd = addDays(weekStart, NUM_DAYS)
    return bookings.filter(b => {
      if (b.room_id !== roomId || !b.checkin || !b.checkout) return false
      const ci = parseISO(b.checkin)
      const co = parseISO(b.checkout)
      return co > weekStart && ci < weekEnd
    })
  }

  function bookingToPixels(b) {
    const ci = parseISO(b.checkin)
    const co = parseISO(b.checkout)
    const ciIdx = differenceInDays(ci, weekStart)
    const coIdx = differenceInDays(co, weekStart)
    const startsBeforeWeek = ciIdx < 0
    const endsAfterWeek = coIdx > NUM_DAYS
    const startX = startsBeforeWeek ? 0 : ciIdx * dayW + half
    const endX = endsAfterWeek ? NUM_DAYS * dayW : coIdx * dayW + half
    if (endX <= startX) return null
    return { left: startX, width: endX - startX, booking: b, startsBeforeWeek, endsAfterWeek }
  }

  return (
    <div style={s.page}>

      {modal && (
        <DetailModal
          booking={modal} rooms={rooms} bookings={bookings}
          onClose={() => setModal(null)}
          onAssign={assignRoom}
          onDelete={deleteBooking}
          saving={saving[modal.id]}
        />
      )}

      {roomModal && (
        <RoomModal
          initial={roomModal}
          onClose={() => setRoomModal(null)}
          onSave={saveRoom}
          saving={saving._room}
        />
      )}

      <div style={s.topbar}>
        <div>
          <span style={s.hotelName}>Hotell Vänersborg</span>
          <span style={s.adminBadge}>Admin</span>
        </div>
        <div style={s.tabs}>
          <TabBtn label="Kalender" active={tab==='calendar'} onClick={() => setTab('calendar')} />
          <TabBtn label="Bokningar" active={tab==='bookings'} onClick={() => setTab('bookings')} />
          <TabBtn label="Importera XLS" active={tab==='import'} onClick={() => setTab('import')} badge={importPreview.length || null} />
          <TabBtn label="Rum" active={tab==='rooms'} onClick={() => setTab('rooms')} />
          <button style={s.signoutBtn} onClick={signOut}>Logga ut</button>
        </div>
      </div>

      {tab === 'calendar' && (
        <div>
          <div style={ac.viewHeader}>
            <button style={ac.navBtn} onClick={() => setWeekStart(d => addDays(d, -7))}>← Föregående</button>
            <div style={ac.titleWrap}>
              <div style={ac.kicker}>Admin · veckoöversikt</div>
              <div style={ac.title}>
                {format(weekStart, 'd MMM', { locale: sv })} – {format(addDays(weekStart, 6), 'd MMM yyyy', { locale: sv })}
              </div>
            </div>
            <button style={ac.navBtn} onClick={() => setWeekStart(d => addDays(d, 7))}>Nästa →</button>
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
            <div style={ac.longTermBanner}>
              <strong>Långtidsboende denna vecka:</strong> {longTermRooms.map(r => r.name).join(', ')}
            </div>
          )}

          <div ref={setCalRef} style={ac.wrap}>
            <div style={ac.headerRow}>
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
              return (
                <div key={room.id} style={ac.row}>
                  <div style={ac.roomLabel}>
                    <span style={ac.roomName}>{room.name}</span>
                    <span style={ac.roomType}>{room.type}</span>
                    {isLongTermActiveInDays(room, days) && <span style={ac.longTermMini}>Långtidsboende</span>}
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
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                            <span style={ac.bookingName}>{firstName}</span>
                            {hasRemark && <span style={ac.bookingRemarkDot}>●</span>}
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
            ].map(([color, label]) => (
              <div key={label} style={ac.legendItem}>
                {label.startsWith('●')
                  ? <span style={{ color, fontSize: 11 }}>●</span>
                  : <div style={{ width: 26, height: 12, borderRadius: 999, background: color, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.45)' }} />}
                <span style={ac.legendText}>{label.replace('● ', '')}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'bookings' && (
        <div>
          <div style={s.statsRow}>
            <StatCard label="Totalt" value={bookings.length} />
            <StatCard label="Tilldelade rum" value={assigned.length} accent />
            <StatCard label="Ej tilldelade" value={unassigned.length} warn={unassigned.length > 0} />
          </div>

          {unassigned.length > 0 && (
            <div style={s.section}>
              <SectionTitle>Ej tilldelat rum ({unassigned.length})</SectionTitle>
              <div style={s.tableWrap}>
                <table style={s.table}>
                  <thead><tr>
                    <Th>Gäst</Th><Th>Incheckning</Th><Th>Utcheckning</Th>
                    <Th>Kategori (Booking.com)</Th><Th>Tilldela rum</Th><Th></Th>
                  </tr></thead>
                  <tbody>
                    {unassigned.map(b => (
                      <BookingRow key={b.id} b={b} rooms={rooms} onAssign={assignRoom}
                        onDelete={deleteBooking} saving={saving[b.id]}
                        onInfo={() => setModal(b)} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div style={s.section}>
            <SectionTitle>Tilldelade ({assigned.length})</SectionTitle>
            <div style={s.tableWrap}>
              <table style={s.table}>
                <thead><tr>
                  <Th>Rum</Th><Th>Gäst</Th><Th>Incheckning</Th><Th>Utcheckning</Th>
                  <Th>Kategori</Th><Th>Byt rum</Th><Th></Th>
                </tr></thead>
                <tbody>
                  {assigned.map(b => (
                    <BookingRow key={b.id} b={b} rooms={rooms} onAssign={assignRoom}
                      onDelete={deleteBooking} saving={saving[b.id]}
                      onInfo={() => setModal(b)} showRoom />
                  ))}
                </tbody>
              </table>
            </div>
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
                <Th>Rum-ID</Th><Th>Namn</Th><Th>Typ</Th><Th>Kapacitet</Th><Th>Adminanteckning</Th><Th>Långtidsboende</Th><Th>Aktiva bokningar</Th><Th></Th>
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

function RoomModal({ initial, onClose, onSave, saving }) {
  const [form, setForm] = useState({
    ...EMPTY_ROOM,
    ...initial,
    capacity: initial.capacity || 1,
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
function DetailModal({ booking: b, rooms, bookings, onClose, onAssign, onDelete, saving }) {
  const room = rooms.find(r => r.id === b.room_id)
  const nights = differenceInDays(parseISO(b.checkout), parseISO(b.checkin))
  const candidates = extractRoomCandidates(b.unit_type)

  const siblings = b.multi_room_original_id
    ? bookings.filter(x => x.multi_room_original_id === b.multi_room_original_id && x.id !== b.id)
    : []

  return (
    <div style={ms.overlay} onClick={onClose}>
      <div style={ms.modal} onClick={e => e.stopPropagation()}>
        <div style={ms.header}>
          <div>
            <div style={ms.roomLabel}>{room ? room.name : 'Inget rum tilldelat'}</div>
            <div style={ms.roomType}>{room?.type || b.unit_type}</div>
          </div>
          <button style={ms.closeBtn} onClick={onClose}>✕</button>
        </div>

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

        {siblings.length > 0 && (
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

        {b.remarks && (
          <div style={ms.remarks}>
            <div style={ms.remarksLabel}>Meddelande från gäst</div>
            <div style={ms.remarksText}>{b.remarks}</div>
          </div>
        )}

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

        <div style={ms.footer}>
          <button style={ms.deleteBtn} onClick={() => onDelete(b.id)}>Ta bort bokning</button>
          <button style={ms.doneBtn} onClick={onClose}>Stäng</button>
        </div>
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

function BookingRow({ b, rooms, onAssign, onDelete, saving, showRoom, onInfo }) {
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
      <td style={s.td}>
        <button style={s.infoBtn} onClick={onInfo}>ℹ</button>
        <button style={s.deleteBtn} onClick={() => onDelete(b.id)}>✕</button>
      </td>
    </tr>
  )
}

function TabBtn({ label, active, onClick, badge }) {
  return (
    <button style={{ ...s.tabBtn, ...(active ? s.tabBtnActive : {}) }} onClick={onClick}>
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
  page: { maxWidth: 1180, margin: '0 auto', padding: '0 16px 80px', fontFamily: 'system-ui, sans-serif' },
  topbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 0 12px', borderBottom: '1px solid #eee', marginBottom: 20, flexWrap: 'wrap', gap: 8 },
  hotelName: { fontSize: 16, fontWeight: 600, color: '#1a1a1a', marginRight: 8 },
  adminBadge: { fontSize: 10, fontWeight: 600, background: '#1a1a1a', color: '#fff', padding: '2px 7px', borderRadius: 20 },
  tabs: { display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' },
  tabBtn: { padding: '6px 14px', border: '1px solid #ddd', borderRadius: 7, background: 'transparent', fontSize: 13, cursor: 'pointer', color: '#666', position: 'relative' },
  tabBtnActive: { background: '#1a1a1a', color: '#fff', borderColor: '#1a1a1a' },
  tabBadge: { position: 'absolute', top: -6, right: -6, background: '#e74c3c', color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 10, minWidth: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' },
  signoutBtn: { fontSize: 12, padding: '5px 10px', border: '1px solid #ddd', borderRadius: 6, background: 'transparent', cursor: 'pointer', color: '#888', marginLeft: 8 },
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
  statCard: { background: '#f7f6f2', borderRadius: 8, padding: '14px 16px' },
  statAccent: { background: '#eaf3de' },
  statWarn: { background: '#fdf8f2' },
  statLabel: { fontSize: 11, color: '#888', marginBottom: 4 },
  statVal: { fontSize: 26, fontWeight: 700, color: '#1a1a1a' },
  section: { marginBottom: 28 },
  sectionTitle: { fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#888', marginBottom: 10 },
  tableWrap: { overflowX: 'auto', borderRadius: 8, border: '1px solid #e8e5df' },
  table: { borderCollapse: 'collapse', width: '100%', fontSize: 13 },
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
  titleWrap: { textAlign: 'center', flex: 1, minWidth: 280 },
  kicker: { fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#8fa0b5', fontWeight: 700, marginBottom: 8 },
  title: { fontSize: 32, fontWeight: 750, color: '#18212f', letterSpacing: '-0.03em' },
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
  wrap: { ...glassPanel, borderRadius: 28, overflow: 'hidden', width: '100%', background: 'rgba(255,255,255,0.64)' },
  headerRow: { display: 'flex', borderBottom: '1px solid rgba(119,136,153,0.28)', background: 'rgba(255,255,255,0.28)' },
  todayDot: { width: 6, height: 6, borderRadius: '50%', background: '#4f8df7', margin: '6px auto 0', boxShadow: '0 0 0 5px rgba(79,141,247,0.12)' },
  row: { display: 'flex', height: ROW_HEIGHT, borderBottom: '1px solid rgba(119,136,153,0.18)', background: 'rgba(255,255,255,0.28)', position: 'relative' },
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
}
