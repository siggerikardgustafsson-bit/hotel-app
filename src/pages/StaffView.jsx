import React, { useEffect, useState, useCallback } from 'react'
import { supabase, signOut } from '../lib/supabase'
import { format, addDays, startOfWeek, isSameDay, parseISO, differenceInDays } from 'date-fns'
import { sv } from 'date-fns/locale'

// Load Playfair Display for hotel name
if (!document.getElementById('gfont-playfair')) {
  const link = document.createElement('link')
  link.id = 'gfont-playfair'
  link.rel = 'stylesheet'
  link.href = 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;600&family=Inter:wght@400;500;600&display=swap'
  document.head.appendChild(link)
}

const TODAY = new Date()
TODAY.setHours(0, 0, 0, 0)

// Design tokens
const C = {
  bg:       '#f8f7f4',
  surface:  '#ffffff',
  border:   '#e8e4dc',
  border2:  '#d8d2c8',
  text:     '#1a1814',
  muted:    '#8c877e',
  faint:    '#b8b2a8',
  blue:     '#2563eb',
  blueLight:'#eff6ff',
  blueMid:  '#bfdbfe',
  block:    '#1e1e1e',
  blockHov: 'rgba(30,30,30,0.82)',
  remark:   '#92400e',
  remarkBg: '#fffbeb',
  remarkBd: '#fde68a',
  red:      '#dc2626',
  green:    '#16a34a',
  purple:   '#7c3aed',
}

function fmtDay(d)     { return format(d, 'EEE d/M', { locale: sv }) }
function fmtDayLong(d) { return format(d, 'EEEE d MMM', { locale: sv }) }
function fmtFull(d)    { return format(parseISO(d), 'd MMM yyyy', { locale: sv }) }
function sortRooms(r)  { return [...r].sort((a, b) => parseInt(a.id) - parseInt(b.id)) }
function ds(d)         { return format(d, 'yyyy-MM-dd') }

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

// Calendar uses % widths so it fills its container perfectly
const NUM_DAYS     = 7
const ROW_HEIGHT   = 60
const ROOM_COL_PCT = 11   // percent of calendar width for room label

export default function StaffView() {
  const [rooms, setRooms] = useState([])
  const [bookings, setBookings] = useState([])
  const [housekeeping, setHousekeeping] = useState({})
  const [weekStart, setWeekStart] = useState(() => startOfWeek(TODAY, { weekStartsOn: 1 }))
  const [view, setView] = useState('today')
  const [modal, setModal] = useState(null)
  const [calRef, setCalRef] = useState(null)
  const [calWidth, setCalWidth] = useState(900)

  useEffect(() => {
    supabase.from('rooms').select('*').then(({ data }) => setRooms(sortRooms(data || [])))
    supabase.from('bookings').select('*').then(({ data }) => setBookings(data || []))
    fetchHousekeeping()
  }, [])

  // Measure actual calendar container width for pixel-accurate block positioning
  useEffect(() => {
    if (!calRef) return
    const obs = new ResizeObserver(entries => {
      setCalWidth(entries[0].contentRect.width)
    })
    obs.observe(calRef)
    return () => obs.disconnect()
  }, [calRef])

  const fetchHousekeeping = useCallback(async () => {
    const { data } = await supabase.from('housekeeping').select('*')
    const map = {}
    ;(data || []).forEach(h => { map[`${h.room_id}_${h.date}`] = h })
    setHousekeeping(map)
  }, [])

  async function upsertHK(roomId, date, patch) {
    const key = `${roomId}_${date}`
    const { data } = await supabase.from('housekeeping')
      .upsert({ room_id: roomId, date, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'room_id,date' })
      .select().single()
    if (data) setHousekeeping(prev => ({ ...prev, [key]: data }))
  }

  async function toggleCleaning(roomId, date) {
    const key = `${roomId}_${date}`
    const cur = housekeeping[key]
    const next = cur?.cleaning_status === 'done' ? 'pending' : 'done'
    await upsertHK(roomId, date, { cleaning_status: next })
  }

  const days     = Array.from({ length: NUM_DAYS }, (_, i) => addDays(weekStart, i))
  const todayStr = ds(TODAY)
  const todayFmt = format(TODAY, 'EEEE d MMMM yyyy', { locale: sv })

  const checkouts = bookings.filter(b => b.checkout === todayStr && b.room_id)
  const checkins  = bookings.filter(b => b.checkin  === todayStr && b.room_id)
  const stays     = bookings.filter(b => b.checkin < todayStr && b.checkout > todayStr && b.room_id)
  const cleanDone = checkouts.filter(b => {
    const hk = housekeeping[`${b.room_id}_${todayStr}`]
    return hk?.cleaning_status === 'done' || hk?.checkout_done
  }).length
  const longTermToday = rooms.filter(r => isLongTermActive(r, todayStr))
  const longTermWeek = rooms.filter(r => isLongTermActiveInDays(r, days))
  const staffDisplayRooms = [...rooms].sort((a, b) => {
    const aLong = isLongTermActiveInDays(a, days) ? 1 : 0
    const bLong = isLongTermActiveInDays(b, days) ? 1 : 0
    if (aLong !== bLong) return aLong - bLong
    return parseInt(a.id, 10) - parseInt(b.id, 10)
  })

  // Pixel maths — derive from actual measured width
  const gridW    = calWidth * (1 - ROOM_COL_PCT / 100)
  const dayW     = gridW / NUM_DAYS
  const roomColW = calWidth * ROOM_COL_PCT / 100
  const half     = dayW / 2

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
    const ci    = parseISO(b.checkin)
    const co    = parseISO(b.checkout)
    const ciIdx = differenceInDays(ci, weekStart)
    const coIdx = differenceInDays(co, weekStart)
    const startsBeforeWeek = ciIdx < 0
    const endsAfterWeek = coIdx >= NUM_DAYS
    const startX = startsBeforeWeek ? 0 : ciIdx * dayW + half
    const endX   = endsAfterWeek ? NUM_DAYS * dayW : coIdx * dayW + half
    if (endX <= startX) return null
    return { left: startX, width: endX - startX, booking: b, startsBeforeWeek, endsAfterWeek }
  }

  function getBookingStaffStatus(roomId, booking) {
    const checkinHK = housekeeping[`${roomId}_${booking.checkin}`]
    const checkoutHK = housekeeping[`${roomId}_${booking.checkout}`]
    if (checkoutHK?.checkout_done) return { label: 'Utcheckad', color: '#22c55e' }
    if (checkinHK?.checkin_done) return { label: 'Incheckad', color: '#3b82f6' }
    return { label: 'Ej markerad', color: '#94a3b8' }
  }

  return (
    <div style={{ fontFamily: "'Inter', system-ui, sans-serif", background: C.bg, minHeight: '100vh' }}>
      {modal && (
        <BookingModal
          booking={modal} rooms={rooms} housekeeping={housekeeping}
          onClose={() => setModal(null)}
          onToggleCleaning={toggleCleaning}
          onUpsertHK={upsertHK}
          todayStr={todayStr}
        />
      )}

      {/* ── TOP NAV ── */}
      <div style={n.nav}>
        <div style={n.navInner}>
          <span style={n.logo}>Hotell Vänersborg</span>
          <div style={n.navRight}>
            <div style={n.tabs}>
              <button style={{...n.tab, ...(view==='today' ? n.tabActive : {})}} onClick={() => setView('today')}>Idag</button>
              <button style={{...n.tab, ...(view==='week'  ? n.tabActive : {})}} onClick={() => setView('week')}>Kalender</button>
            </div>
            <button style={n.signout} onClick={signOut}>Logga ut</button>
          </div>
        </div>
      </div>

      {/* ── CONTENT ── */}
      <div style={n.content}>

        {/* ── TODAY ── */}
        {view === 'today' && (
          <div>
            <div style={p.dateRow}>
              <div style={p.dateText}>{todayFmt}</div>
            </div>

            {/* Stats */}
            <div style={p.statsGrid}>
              <StatTile icon="↑" label="Utcheckningar" value={checkouts.length} color={C.red} />
              <StatTile icon="✓" label="Städning klar" value={`${cleanDone} / ${checkouts.length}`} color={C.green} done={cleanDone === checkouts.length && checkouts.length > 0} />
              <StatTile icon="↓" label="Incheckningar" value={checkins.length} color={C.blue} />
              <StatTile icon="●" label="Bor kvar" value={stays.length} color={C.purple} />
              <StatTile icon="⌂" label="Långtidsboende" value={longTermToday.length} color="#b45309" />
            </div>

            <TodaySection label="Utcheckningar & städning" count={checkouts.length} color={C.red}>
              {checkouts.length === 0
                ? <Empty text="Inga utcheckningar idag" />
                : checkouts.map(b => {
                    const hk = housekeeping[`${b.room_id}_${todayStr}`]
                    const cs = hk?.cleaning_status || 'pending'
                    return (
                      <TodayCard key={b.id} b={b} rooms={rooms} type="checkout" color={C.red} onClick={() => setModal(b)}>
                        <div style={p.actions}>
                          <Btn label={cs==='done'?'✓ Städat':cs==='in_progress'?'Städar…':'Markera städat'}
                            done={cs==='done'} active={cs==='in_progress'}
                            onClick={e => { e.stopPropagation(); toggleCleaning(b.room_id, todayStr) }} />
                          <Btn label={hk?.checkout_done?'✓ Utcheckad':'Markera utcheckad'}
                            done={hk?.checkout_done}
                            onClick={e => { e.stopPropagation(); upsertHK(b.room_id, todayStr, { checkout_done: !hk?.checkout_done }) }} />
                        </div>
                      </TodayCard>
                    )
                  })
              }
            </TodaySection>

            <TodaySection label="Incheckningar" count={checkins.length} color={C.blue}>
              {checkins.length === 0
                ? <Empty text="Inga incheckningar idag" />
                : checkins.map(b => {
                    const hk = housekeeping[`${b.room_id}_${todayStr}`]
                    return (
                      <TodayCard key={b.id} b={b} rooms={rooms} type="checkin" color={C.blue} onClick={() => setModal(b)}>
                        <div style={p.actions}>
                          <Btn label={hk?.checkin_done?'✓ Incheckad':'Markera incheckad'}
                            done={hk?.checkin_done}
                            onClick={e => { e.stopPropagation(); upsertHK(b.room_id, todayStr, { checkin_done: !hk?.checkin_done }) }} />
                        </div>
                      </TodayCard>
                    )
                  })
              }
            </TodaySection>

            <TodaySection label="Bor kvar" count={stays.length} color={C.purple}>
              {stays.length === 0
                ? <Empty text="Inga gäster bor kvar" />
                : stays.map(b => <TodayCard key={b.id} b={b} rooms={rooms} type="stay" color={C.purple} onClick={() => setModal(b)} />)
              }
            </TodaySection>

            {longTermToday.length > 0 && (
              <TodaySection label="Långtidsboende" count={longTermToday.length} color="#f59e0b">
                {longTermToday.map(room => (
                  <LongTermRoomCard key={room.id} room={room} />
                ))}
              </TodaySection>
            )}

          </div>
        )}

        {/* ── CALENDAR ── */}
        {view === 'week' && (
          <div>
            {/* Week nav */}
            <div style={cal.nav}>
              <button style={cal.navBtn} onClick={() => setWeekStart(d => addDays(d, -7))}>← Föregående</button>
              <span style={cal.title}>
                {format(weekStart, 'd MMM', { locale: sv })} – {format(addDays(weekStart, 6), 'd MMM yyyy', { locale: sv })}
              </span>
              <button style={cal.navBtn} onClick={() => setWeekStart(d => addDays(d, 7))}>Nästa →</button>
            </div>

            {/* Calendar grid — ref so we can measure actual px width */}
            {longTermWeek.length > 0 && (
              <div style={cal.longTermBanner}>
                <b>Långtidsboende denna vecka:</b> {longTermWeek.map(r => r.name).join(', ')}
              </div>
            )}

            <div ref={setCalRef} style={cal.wrap}>

              {/* Header row */}
              <div style={cal.headerRow}>
                <div style={{ width: `${ROOM_COL_PCT}%`, flexShrink: 0, borderRight: `1px solid ${C.border}` }} />
                {days.map((d, i) => {
                  const isToday = isSameDay(d, TODAY)
                  return (
                    <div key={i} style={{
                      flex: 1,
                      textAlign: 'center',
                      padding: '10px 4px 8px',
                      fontSize: 11,
                      fontWeight: isToday ? 700 : 500,
                      color: isToday ? C.blue : C.muted,
                      background: isToday ? C.blueLight : 'transparent',
                      borderLeft: i > 0 ? `1px solid ${C.border}` : 'none',
                      letterSpacing: '0.02em',
                    }}>
                      {fmtDay(d)}
                      {isToday && <div style={{ width: 4, height: 4, borderRadius: '50%', background: C.blue, margin: '4px auto 0' }} />}
                    </div>
                  )
                })}
              </div>

              {/* Rows */}
              {staffDisplayRooms.map((room, ri) => {
                const pixels = getVisibleBookings(room.id).map(b => bookingToPixels(b)).filter(Boolean)
                return (
                  <div key={room.id} style={{
                    display: 'flex',
                    height: ROW_HEIGHT,
                    borderBottom: `1px solid ${C.border}`,
                    background: C.surface,
                    position: 'relative',
                  }}>
                    {/* Room label */}
                    <div style={{
                      width: `${ROOM_COL_PCT}%`,
                      flexShrink: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'center',
                      padding: '0 12px',
                      borderRight: `1px solid ${C.border}`,
                      background: '#faf9f7',
                    }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{room.name}</span>
                      <span style={{ fontSize: 10, color: C.faint, marginTop: 1 }}>{room.type}</span>
                      {isLongTermActiveInDays(room, days) && (
                        <span style={{ display: 'inline-block', marginTop: 4, background: '#fffbeb', color: '#92400e', fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 20 }}>
                          Långtidsboende
                        </span>
                      )}
                    </div>

                    {/* Grid area */}
                    <div style={{ position: 'relative', flex: 1, height: '100%' }}>
                      {/* Column lines + today highlight */}
                      {days.map((d, i) => (
                        <React.Fragment key={i}>
                          {i > 0 && (
                            <div style={{ position: 'absolute', left: i * dayW, top: 0, bottom: 0, width: 1, background: C.border, pointerEvents: 'none' }} />
                          )}
                          {isLongTermActive(room, d) && (
                            <div style={{ position: 'absolute', left: i * dayW, width: dayW, top: 0, bottom: 0, background: 'rgba(245,158,11,0.10)', pointerEvents: 'none' }} />
                          )}
                          {isLongTermActive(room, d) && (
                            <div style={{ position: 'absolute', left: i * dayW, width: dayW, top: 0, bottom: 0, background: 'rgba(245,158,11,0.10)', pointerEvents: 'none' }} />
                          )}
                          {isSameDay(d, TODAY) && (
                            <div style={{ position: 'absolute', left: i * dayW, width: dayW, top: 0, bottom: 0, background: C.blueLight, opacity: 0.5, pointerEvents: 'none' }} />
                          )}
                        </React.Fragment>
                      ))}

                      {/* Booking blocks */}
                      {pixels.map(({ left, width, booking, startsBeforeWeek, endsAfterWeek }) => {
                        const checkoutHK = housekeeping[`${room.id}_${booking.checkout}`]
                        const cleaned  = checkoutHK?.cleaning_status === 'done' || checkoutHK?.checkout_done
                        const status = getBookingStaffStatus(room.id, booking)
                        const hasRemark = !!booking.remarks
                        const nights   = differenceInDays(parseISO(booking.checkout), parseISO(booking.checkin))
                        const firstName = booking.guest_name?.split(' ')[0] || ''
                        const showSub  = width > dayW * 1.1

                        return (
                          <div
                            key={booking.id}
                            onClick={() => setModal(booking)}
                            title={`${booking.guest_name} · ${nights} natt${nights !== 1 ? 'er' : ''}`}
                            style={{
                              position: 'absolute',
                              left: left + 3,
                              width: Math.max(width - 6, 16),
                              top: 8, bottom: 8,
                              background: cleaned ? 'linear-gradient(135deg, #86efac, #4ade80)' : C.block,
                              borderTopLeftRadius: startsBeforeWeek ? 2 : 7,
                              borderBottomLeftRadius: startsBeforeWeek ? 2 : 7,
                              borderTopRightRadius: endsAfterWeek ? 2 : 7,
                              borderBottomRightRadius: endsAfterWeek ? 2 : 7,
                              cursor: 'pointer',
                              display: 'flex',
                              flexDirection: 'column',
                              justifyContent: 'center',
                              padding: '0 9px',
                              overflow: 'hidden',
                              userSelect: 'none',
                              boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
                              transition: 'opacity 0.12s',
                            }}
                            onMouseEnter={e => e.currentTarget.style.opacity = '0.8'}
                            onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, paddingRight: 18 }}>
                              <span style={{ fontSize: 11, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {firstName}
                              </span>
                              {hasRemark && <span style={{ fontSize: 8, color: '#fbbf24', flexShrink: 0 }}>●</span>}
                            </div>
                            <div title={status.label} style={{ ...cal.bookingStatusDot, background: status.color }} />
                            {startsBeforeWeek && <div style={cal.continuesLeft} />}
                            {endsAfterWeek && <div style={cal.continuesRight} />}
                            {showSub && (
                              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.45)', marginTop: 1, whiteSpace: 'nowrap' }}>
                                {nights} natt{nights !== 1 ? 'er' : ''} · {booking.people} pers.
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Legend */}
            <div style={cal.legend}>
              {[[C.block,'Bokning'],[`#94a3b8`,'Städat'],['#fbbf24','● Meddelande']].map(([color, label]) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {label.startsWith('●')
                    ? <span style={{ color, fontSize: 10 }}>●</span>
                    : <div style={{ width: 24, height: 10, borderRadius: 3, background: color }} />
                  }
                  <span style={{ fontSize: 11, color: C.muted }}>{label.replace('● ','')}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ── MODAL ── */
function BookingModal({ booking: b, rooms, housekeeping, onClose, onToggleCleaning, onUpsertHK, todayStr }) {
  const room = rooms.find(r => r.id === b.room_id)
  const hk   = housekeeping[`${b.room_id}_${todayStr}`]
  const isOut = b.checkout === todayStr
  const isIn  = b.checkin  === todayStr
  const nights = differenceInDays(parseISO(b.checkout), parseISO(b.checkin))
  const statusLabel = isOut ? 'Utcheckning idag' : isIn ? 'Incheckning idag' : 'Bor kvar'
  const statusColor = isOut ? C.red : isIn ? C.blue : C.purple

  return (
    <div style={m.overlay} onClick={onClose}>
      <div style={m.sheet} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={m.top}>
          <div style={{ ...m.statusBadge, background: statusColor + '18', color: statusColor }}>
            {statusLabel}
          </div>
          <button style={m.closeBtn} onClick={onClose}>✕</button>
        </div>

        {/* Room + Guest */}
        <div style={m.hero}>
          <div style={m.heroRoom}>{room?.name || `Rum ${b.room_id}`}</div>
          <div style={m.heroGuest}>{b.guest_name}</div>
          <div style={m.heroSub}>{room?.type}</div>
        </div>

        {/* Info grid */}
        <div style={m.grid}>
          <InfoTile label="Incheckning"  value={fmtFull(b.checkin)} />
          <InfoTile label="Utcheckning"  value={fmtFull(b.checkout)} />
          <InfoTile label="Nätter"       value={nights} />
          <InfoTile label="Gäster"       value={`${b.people} pers.`} />
          <InfoTile label="Bokningsnr"   value={`#${b.multi_room_original_id || b.id}`} wide />
          {b.price && <InfoTile label="Pris" value={b.price} />}
        </div>

        {/* Remark */}
        {b.remarks && (
          <div style={m.remark}>
            <div style={m.remarkLabel}><span style={{ color: '#fbbf24' }}>●</span> Meddelande från gäst</div>
            <div style={m.remarkText}>{b.remarks.replace(/&#39;/g, "'")}</div>
          </div>
        )}

        {/* Actions */}
        {(isOut || isIn) && (
          <div style={m.actions}>
            {isOut && (<>
              <ModalBtn label={hk?.cleaning_status==='done'?'✓ Städning klar':hk?.cleaning_status==='in_progress'?'Städar…':'Markera städat'}
                done={hk?.cleaning_status==='done'} active={hk?.cleaning_status==='in_progress'}
                onClick={() => onToggleCleaning(b.room_id, todayStr)} />
              <ModalBtn label={hk?.checkout_done?'✓ Utcheckad':'Markera utcheckad'}
                done={hk?.checkout_done}
                onClick={() => onUpsertHK(b.room_id, todayStr, { checkout_done: !hk?.checkout_done })} />
            </>)}
            {isIn && (
              <ModalBtn label={hk?.checkin_done?'✓ Incheckad':'Markera incheckad'}
                done={hk?.checkin_done}
                onClick={() => onUpsertHK(b.room_id, todayStr, { checkin_done: !hk?.checkin_done })} />
            )}
          </div>
        )}

        <div style={m.footer}>
          <button style={m.closeFooter} onClick={onClose}>Stäng</button>
        </div>
      </div>
    </div>
  )
}

/* ── SMALL COMPONENTS ── */
function InfoTile({ label, value, wide }) {
  return (
    <div style={{ ...m.tile, ...(wide ? { gridColumn: 'span 2' } : {}) }}>
      <div style={m.tileLabel}>{label}</div>
      <div style={m.tileValue}>{value}</div>
    </div>
  )
}

function ModalBtn({ label, done, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      fontSize: 12, padding: '8px 14px', border: `1px solid ${C.border2}`,
      borderRadius: 8, background: done ? '#f0fdf4' : active ? '#fffbeb' : C.surface,
      cursor: 'pointer', color: done ? C.green : active ? C.remark : C.text, fontWeight: 500,
      ...(done ? { borderColor: '#86efac' } : active ? { borderColor: C.remarkBd } : {}),
    }}>{label}</button>
  )
}

function StatTile({ icon, label, value, color, done }) {
  return (
    <div style={{ ...p.statTile, ...(done ? { background: '#f0fdf4', borderColor: '#bbf7d0' } : {}) }}>
      <div style={{ fontSize: 11, color, fontWeight: 700, marginBottom: 6, opacity: 0.7 }}>{icon}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: C.text, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11, color: C.muted, marginTop: 5, fontWeight: 500 }}>{label}</div>
    </div>
  )
}

function TodaySection({ label, count, color, children }) {
  return (
    <div style={p.section}>
      <div style={p.sectionHead}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, marginRight: 8 }} />
        <span style={p.sectionLabel}>{label}</span>
        <span style={p.sectionCount}>{count}</span>
      </div>
      {children}
    </div>
  )
}

function LongTermRoomCard({ room }) {
  const period = room.long_term_end
    ? `${room.long_term_start || 'nu'} → ${room.long_term_end}`
    : `${room.long_term_start || 'nu'} → tills vidare`

  return (
    <div style={{ ...p.card, borderTop: '1px solid rgba(245,158,11,0.35)' }}>
      <div style={p.cardTop}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span style={p.cardRoom}>{room.name}</span>
          <span style={p.cardType}>{room.type}</span>
        </div>
        <span style={{ ...p.cardBadge, background: 'rgba(245,158,11,0.14)', color: '#92400e' }}>Långtidsboende</span>
      </div>
      <div style={p.cardTimes}>{period}</div>
      {room.long_term_note && <div style={p.remark}>{room.long_term_note}</div>}
    </div>
  )
}

function TodayCard({ b, rooms, type, color, onClick, children }) {
  const room   = rooms.find(r => r.id === b.room_id)
  const nights = differenceInDays(parseISO(b.checkout), parseISO(b.checkin))
  return (
    <div style={{ ...p.card, borderLeft: `3px solid ${color}` }} onClick={onClick}>
      <div style={p.cardTop}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={p.cardRoom}>{room?.name || `Rum ${b.room_id}`}</span>
          <span style={p.cardType}>{room?.type}</span>
        </div>
        <span style={{ ...p.cardBadge, background: color + '14', color }}>
          {type === 'checkout' ? 'Utcheckning' : type === 'checkin' ? 'Incheckning' : 'Bor kvar'}
        </span>
      </div>
      <div style={p.cardGuest}>
        {b.guest_name}
        <span style={p.cardMeta}>{b.people} pers. · {nights} natt{nights !== 1 ? 'er' : ''}</span>
      </div>
      <div style={p.cardTimes}>
        {type === 'checkout' && `Checkat in ${b.checkin} · Checkar ut idag 11:00`}
        {type === 'checkin'  && `Checkar in idag 14:00 · Checkar ut ${b.checkout}`}
        {type === 'stay'     && `${b.checkin} → ${b.checkout}`}
      </div>
      {b.remarks && (
        <div style={p.remark}>
          <span style={{ color: '#f59e0b', marginRight: 5, fontSize: 10 }}>●</span>
          {b.remarks.replace(/&#39;/g, "'").slice(0, 130)}{b.remarks.length > 130 ? '…' : ''}
        </div>
      )}
      {children}
    </div>
  )
}

function Btn({ label, done, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      fontSize: 12, padding: '6px 12px', border: `1px solid ${C.border2}`,
      borderRadius: 7, background: done ? '#f0fdf4' : active ? '#fffbeb' : '#fff',
      cursor: 'pointer', color: done ? C.green : active ? C.remark : C.muted, fontWeight: 500,
      ...(done ? { borderColor: '#86efac' } : active ? { borderColor: C.remarkBd } : {}),
    }}>{label}</button>
  )
}

function Empty({ text }) {
  return <div style={{ fontSize: 13, color: C.faint, padding: '12px 0' }}>{text}</div>
}

/* ── STYLES ── */
const n = {
  nav: { background: C.surface, borderBottom: `1px solid ${C.border}`, position: 'sticky', top: 0, zIndex: 100 },
  navInner: { maxWidth: 1320, margin: '0 auto', padding: '0 24px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  logo: { fontFamily: "'Playfair Display', Georgia, serif", fontSize: 20, fontWeight: 600, color: C.text, letterSpacing: '-0.01em' },
  navRight: { display: 'flex', alignItems: 'center', gap: 12 },
  tabs: { display: 'flex', background: C.bg, borderRadius: 8, padding: 3, border: `1px solid ${C.border}` },
  tab: { padding: '5px 16px', border: 'none', background: 'transparent', borderRadius: 6, fontSize: 13, cursor: 'pointer', color: C.muted, fontWeight: 500 },
  tabActive: { background: C.surface, color: C.text, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' },
  signout: { fontSize: 12, padding: '5px 12px', border: `1px solid ${C.border}`, borderRadius: 7, background: 'transparent', cursor: 'pointer', color: C.faint },
  content: { maxWidth: 1320, margin: '0 auto', padding: '28px 24px 80px' },
}

const p = {
  dateRow: { marginBottom: 20 },
  dateText: { fontSize: 26, fontWeight: 700, color: C.text, letterSpacing: '-0.02em', textTransform: 'capitalize' },
  statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 12, marginBottom: 32 },
  statTile: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px' },
  section: { marginBottom: 28 },
  sectionHead: { display: 'flex', alignItems: 'center', marginBottom: 10 },
  sectionLabel: { fontSize: 12, fontWeight: 700, color: C.text, textTransform: 'uppercase', letterSpacing: '0.06em' },
  sectionCount: { marginLeft: 8, fontSize: 12, color: C.faint, fontWeight: 500 },
  card: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 16px', marginBottom: 8, cursor: 'pointer', transition: 'box-shadow 0.15s' },
  cardTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 5 },
  cardRoom: { fontSize: 13, fontWeight: 700, color: C.text },
  cardType: { fontSize: 11, color: C.faint },
  cardBadge: { fontSize: 10, fontWeight: 600, padding: '3px 9px', borderRadius: 20 },
  cardGuest: { fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 3, display: 'flex', alignItems: 'baseline', gap: 8 },
  cardMeta: { fontSize: 12, color: C.faint, fontWeight: 400 },
  cardTimes: { fontSize: 12, color: C.muted, marginBottom: 2 },
  remark: { fontSize: 12, color: C.remark, background: C.remarkBg, border: `1px solid ${C.remarkBd}`, borderRadius: 7, padding: '7px 10px', marginTop: 8, lineHeight: 1.5 },
  actions: { display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' },
}

const cal = {
  nav: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  title: { fontFamily: "'Playfair Display', Georgia, serif", fontSize: 22, fontWeight: 600, color: C.text, letterSpacing: '-0.01em' },
  navBtn: { fontSize: 13, padding: '7px 16px', border: `1px solid ${C.border2}`, borderRadius: 8, background: C.surface, cursor: 'pointer', color: C.text, fontWeight: 500 },
  wrap: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', width: '100%' },
  headerRow: { display: 'flex', borderBottom: `2px solid ${C.border}`, background: '#faf9f7' },
  longTermBanner: { background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 12, padding: '10px 14px', color: '#92400e', fontSize: 13, marginBottom: 14 },
  bookingStatusDot: { position: 'absolute', right: 7, top: 7, width: 8, height: 8, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.75)', boxShadow: '0 1px 4px rgba(0,0,0,0.16)' },
  continuesLeft: { position: 'absolute', left: 0, top: 6, bottom: 6, width: 3, background: 'rgba(255,255,255,0.8)', borderRadius: 10 },
  continuesRight: { position: 'absolute', right: 0, top: 6, bottom: 6, width: 3, background: 'rgba(255,255,255,0.8)', borderRadius: 10 },
  legend: { display: 'flex', gap: 18, marginTop: 14, flexWrap: 'wrap', alignItems: 'center' },
}

const m = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(15,15,15,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 16, backdropFilter: 'blur(2px)' },
  sheet: { background: C.surface, borderRadius: 16, width: '100%', maxWidth: 440, boxShadow: '0 24px 64px rgba(0,0,0,0.2)', overflow: 'hidden', maxHeight: '90vh', overflowY: 'auto' },
  top: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 20px 0' },
  statusBadge: { fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 20, letterSpacing: '0.04em' },
  closeBtn: { background: 'transparent', border: 'none', fontSize: 18, color: C.faint, cursor: 'pointer', lineHeight: 1 },
  hero: { padding: '14px 20px 16px', borderBottom: `1px solid ${C.border}` },
  heroRoom: { fontSize: 13, fontWeight: 600, color: C.muted, marginBottom: 4 },
  heroGuest: { fontSize: 22, fontWeight: 700, color: C.text, letterSpacing: '-0.02em', lineHeight: 1.2 },
  heroSub: { fontSize: 12, color: C.faint, marginTop: 4 },
  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: '16px 20px' },
  tile: { background: C.bg, borderRadius: 8, padding: '10px 12px' },
  tileLabel: { fontSize: 10, fontWeight: 600, color: C.faint, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 },
  tileValue: { fontSize: 13, fontWeight: 600, color: C.text },
  remark: { margin: '0 20px 16px', background: C.remarkBg, border: `1px solid ${C.remarkBd}`, borderRadius: 10, padding: '12px 14px' },
  remarkLabel: { fontSize: 11, fontWeight: 700, color: C.remark, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 },
  remarkText: { fontSize: 13, color: '#555', lineHeight: 1.6 },
  actions: { display: 'flex', gap: 8, padding: '0 20px 16px', flexWrap: 'wrap' },
  footer: { padding: '12px 20px 20px', borderTop: `1px solid ${C.border}` },
  closeFooter: { width: '100%', padding: '10px', border: `1px solid ${C.border2}`, borderRadius: 9, background: 'transparent', fontSize: 13, fontWeight: 500, cursor: 'pointer', color: C.muted },
}
