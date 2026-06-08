import React, { useEffect, useState, useCallback } from 'react'
import { supabase, signOut } from '../lib/supabase'
import { format, addDays, startOfWeek, isSameDay, parseISO, differenceInDays } from 'date-fns'
import { sv } from 'date-fns/locale'

if (!document.getElementById('gfont-playfair')) {
  const link = document.createElement('link')
  link.id = 'gfont-playfair'
  link.rel = 'stylesheet'
  link.href = 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap'
  document.head.appendChild(link)
}

const TODAY = new Date()
TODAY.setHours(0, 0, 0, 0)

const C = {
  bgTop: '#f7fbff',
  bgBottom: '#fdfaf6',
  glass: 'rgba(255,255,255,0.64)',
  glassStrong: 'rgba(255,255,255,0.78)',
  glassSoft: 'rgba(255,255,255,0.52)',
  border: 'rgba(255,255,255,0.72)',
  line: 'rgba(119, 136, 153, 0.18)',
  lineStrong: 'rgba(119, 136, 153, 0.28)',
  text: '#18212f',
  muted: '#5f7087',
  faint: '#8fa0b5',
  blue: '#4f8df7',
  blueSoft: 'rgba(79, 141, 247, 0.14)',
  blueSoft2: 'rgba(79, 141, 247, 0.08)',
  red: '#ff7b8f',
  redSoft: 'rgba(255, 123, 143, 0.14)',
  green: '#37b87a',
  greenSoft: 'rgba(55, 184, 122, 0.14)',
  purple: '#8a7cff',
  purpleSoft: 'rgba(138, 124, 255, 0.14)',
  amber: '#f6b73c',
  amberSoft: 'rgba(246, 183, 60, 0.16)',
  block: 'linear-gradient(135deg, rgba(95, 140, 245, 0.76), rgba(121, 202, 255, 0.64))',
  blockDone: 'linear-gradient(135deg, rgba(105, 200, 165, 0.68), rgba(140, 224, 181, 0.56))',
  shadow: '0 18px 45px rgba(86, 104, 140, 0.14)',
  shadowSoft: '0 8px 24px rgba(86, 104, 140, 0.10)',
}

function fmtDay(d)     { return format(d, 'EEE d/M', { locale: sv }) }
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

const NUM_DAYS = 7
const ROW_HEIGHT = 68
const ROOM_COL_PCT = 13

const glassPanel = {
  background: C.glass,
  border: `1px solid ${C.border}`,
  boxShadow: C.shadow,
  backdropFilter: 'blur(22px) saturate(1.5)',
  WebkitBackdropFilter: 'blur(22px) saturate(1.5)',
}

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

  useEffect(() => {
    if (!calRef) return
    const obs = new ResizeObserver(entries => setCalWidth(entries[0].contentRect.width))
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
    const { data } = await supabase
      .from('housekeeping')
      .upsert({ room_id: roomId, date, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'room_id,date' })
      .select()
      .single()
    if (data) setHousekeeping(prev => ({ ...prev, [key]: data }))
  }

  async function toggleCleaning(roomId, date) {
    const key = `${roomId}_${date}`
    const cur = housekeeping[key]
    const next = cur?.cleaning_status === 'done' ? 'pending' : 'done'
    await upsertHK(roomId, date, { cleaning_status: next })
  }

  const days = Array.from({ length: NUM_DAYS }, (_, i) => addDays(weekStart, i))
  const todayStr = ds(TODAY)
  const todayFmt = format(TODAY, 'EEEE d MMMM yyyy', { locale: sv })

  const checkouts = bookings.filter(b => b.checkout === todayStr && b.room_id)
  const checkins = bookings.filter(b => b.checkin === todayStr && b.room_id)
  const stays = bookings.filter(b => b.checkin < todayStr && b.checkout > todayStr && b.room_id)
  const cleanDone = checkouts.filter(b => housekeeping[`${b.room_id}_${todayStr}`]?.cleaning_status === 'done').length
  const longTermToday = rooms.filter(r => isLongTermActive(r, todayStr))
  const longTermWeek = rooms.filter(r => isLongTermActiveInDays(r, days))
  const staffDisplayRooms = [...rooms].sort((a, b) => {
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

      // Include bookings that check out on the first visible day.
      // Example: söndag → måndag should show as a left-edge continuation on Monday.
      return co >= weekStart && ci < weekEnd
    })
  }

  function bookingToPixels(b) {
    const ci = parseISO(b.checkin)
    const co = parseISO(b.checkout)
    const ciIdx = differenceInDays(ci, weekStart)
    const coIdx = differenceInDays(co, weekStart)
    const startsBeforeWeek = ciIdx < 0

    // If checkout is exactly the day after the visible week, the booking should
    // still run to the right edge of the current week with a straight edge.
    const endsAfterWeek = coIdx >= NUM_DAYS

    const startX = startsBeforeWeek ? 0 : ciIdx * dayW + half
    const endX = endsAfterWeek ? NUM_DAYS * dayW : coIdx * dayW + half
    if (endX <= startX) return null
    return { left: startX, width: endX - startX, booking: b, startsBeforeWeek, endsAfterWeek }
  }

  return (
    <div style={s.page}>
      <div style={s.bgBlobOne} />
      <div style={s.bgBlobTwo} />
      <div style={s.bgBlobThree} />

      {modal && (
        <BookingModal
          booking={modal}
          rooms={rooms}
          housekeeping={housekeeping}
          onClose={() => setModal(null)}
          onToggleCleaning={toggleCleaning}
          onUpsertHK={upsertHK}
          todayStr={todayStr}
        />
      )}

      <div style={n.navShell}>
        <div style={n.nav}>
          <div style={n.navInner}>
            <div>
              <div style={n.logo}>Hotell Vänersborg</div>
              <div style={n.logoSub}>Personalyta · bokningar · städstatus</div>
            </div>

            <div style={n.navRight}>
              <div style={n.tabs}>
                <button style={{ ...n.tab, ...(view === 'today' ? n.tabActive : {}) }} onClick={() => setView('today')}>Idag</button>
                <button style={{ ...n.tab, ...(view === 'week' ? n.tabActive : {}) }} onClick={() => setView('week')}>Kalender</button>
              </div>
              <button style={n.signout} onClick={signOut}>Logga ut</button>
            </div>
          </div>
        </div>
      </div>

      <div style={n.content}>
        {view === 'today' && (
          <div>
            <div style={p.viewHeader}>
              <div>
                <div style={p.kicker}>Översikt idag</div>
                <div style={p.dateText}>{todayFmt}</div>
              </div>
              <div style={p.heroChip}>Fokus för personalen idag</div>
            </div>

            <div style={p.statsGrid}>
              <StatTile icon="↑" label="Utcheckningar" value={checkouts.length} color={C.red} />
              <StatTile icon="✓" label="Städning klar" value={`${cleanDone} / ${checkouts.length}`} color={C.green} done={cleanDone === checkouts.length && checkouts.length > 0} />
              <StatTile icon="↓" label="Incheckningar" value={checkins.length} color={C.blue} />
              <StatTile icon="●" label="Bor kvar" value={stays.length} color={C.purple} />
              <StatTile icon="⌂" label="Långtidsboende" value={longTermToday.length} color={C.amber} />
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
                          <Btn
                            label={cs === 'done' ? '✓ Städat' : cs === 'in_progress' ? 'Städar…' : 'Markera städat'}
                            done={cs === 'done'}
                            active={cs === 'in_progress'}
                            onClick={e => { e.stopPropagation(); toggleCleaning(b.room_id, todayStr) }}
                          />
                          <Btn
                            label={hk?.checkout_done ? '✓ Utcheckad' : 'Markera utcheckad'}
                            done={hk?.checkout_done}
                            onClick={e => { e.stopPropagation(); upsertHK(b.room_id, todayStr, { checkout_done: !hk?.checkout_done }) }}
                          />
                        </div>
                      </TodayCard>
                    )
                  })}
            </TodaySection>

            <TodaySection label="Incheckningar" count={checkins.length} color={C.blue}>
              {checkins.length === 0
                ? <Empty text="Inga incheckningar idag" />
                : checkins.map(b => {
                    const hk = housekeeping[`${b.room_id}_${todayStr}`]
                    return (
                      <TodayCard key={b.id} b={b} rooms={rooms} type="checkin" color={C.blue} onClick={() => setModal(b)}>
                        <div style={p.actions}>
                          <Btn
                            label={hk?.checkin_done ? '✓ Incheckad' : 'Markera incheckad'}
                            done={hk?.checkin_done}
                            onClick={e => { e.stopPropagation(); upsertHK(b.room_id, todayStr, { checkin_done: !hk?.checkin_done }) }}
                          />
                        </div>
                      </TodayCard>
                    )
                  })}
            </TodaySection>

            <TodaySection label="Bor kvar" count={stays.length} color={C.purple}>
              {stays.length === 0
                ? <Empty text="Inga gäster bor kvar" />
                : stays.map(b => (
                    <TodayCard key={b.id} b={b} rooms={rooms} type="stay" color={C.purple} onClick={() => setModal(b)} />
                  ))}
            </TodaySection>

            {longTermToday.length > 0 && (
              <TodaySection label="Långtidsboende" count={longTermToday.length} color={C.amber}>
                {longTermToday.map(room => (
                  <LongTermRoomCard key={room.id} room={room} />
                ))}
              </TodaySection>
            )}
          </div>
        )}

        {view === 'week' && (
          <div>
            <div style={p.viewHeader}>
              <button style={cal.navBtn} onClick={() => setWeekStart(d => addDays(d, -7))}>← Föregående</button>
              <div style={cal.titleWrap}>
                <div style={cal.kicker}>Veckoöversikt</div>
                <span style={cal.title}>
                  {format(weekStart, 'd MMM', { locale: sv })} – {format(addDays(weekStart, 6), 'd MMM yyyy', { locale: sv })}
                </span>
              </div>
              <button style={cal.navBtn} onClick={() => setWeekStart(d => addDays(d, 7))}>Nästa →</button>
            </div>

            {longTermWeek.length > 0 && (
              <div style={cal.longTermBanner}>
                <span style={{ fontWeight: 800 }}>Långtidsboende denna vecka:</span>{' '}
                {longTermWeek.map(r => r.name).join(', ')}
              </div>
            )}

            <div ref={setCalRef} style={cal.wrap}>
              <div style={cal.headerRow}>
                <div style={{ width: `${ROOM_COL_PCT}%`, flexShrink: 0, borderRight: `1px solid ${C.line}` }} />
                {days.map((d, i) => {
                  const isToday = isSameDay(d, TODAY)
                  return (
                    <div
                      key={i}
                      style={{
                        flex: 1,
                        textAlign: 'center',
                        padding: '14px 4px 12px',
                        fontSize: 12,
                        fontWeight: isToday ? 700 : 600,
                        color: isToday ? C.blue : C.muted,
                        background: isToday ? 'rgba(255,255,255,0.42)' : 'transparent',
                        borderLeft: i > 0 ? `1px solid ${C.line}` : 'none',
                        letterSpacing: '0.02em',
                      }}
                    >
                      {fmtDay(d)}
                      {isToday && <div style={cal.todayDot} />}
                    </div>
                  )
                })}
              </div>

              {staffDisplayRooms.map(room => {
                const pixels = getVisibleBookings(room.id).map(b => bookingToPixels(b)).filter(Boolean)
                return (
                  <div key={room.id} style={cal.row}>
                    <div style={cal.roomLabel}>
                      <span style={cal.roomName}>{room.name}</span>
                      <span style={cal.roomType}>{room.type}</span>
                      {isLongTermActiveInDays(room, days) && <span style={cal.longTermMini}>Långtidsboende</span>}
                    </div>

                    <div style={{ position: 'relative', flex: 1, height: '100%' }}>
                      {days.map((d, i) => (
                        <React.Fragment key={i}>
                          {i > 0 && (
                            <div style={{ position: 'absolute', left: i * dayW, top: 0, bottom: 0, width: 1, background: C.line, pointerEvents: 'none' }} />
                          )}
                          {isLongTermActive(room, d) && (
                            <div style={{ position: 'absolute', left: i * dayW, width: dayW, top: 0, bottom: 0, background: 'rgba(246,183,60,0.10)', pointerEvents: 'none' }} />
                          )}
                          {isSameDay(d, TODAY) && (
                            <div style={{ position: 'absolute', left: i * dayW, width: dayW, top: 0, bottom: 0, background: C.blueSoft2, pointerEvents: 'none' }} />
                          )}
                        </React.Fragment>
                      ))}

                      {pixels.map(({ left, width, booking, startsBeforeWeek, endsAfterWeek }) => {
                        const checkoutHK = housekeeping[`${room.id}_${booking.checkout}`]
                        const cleaned = checkoutHK?.cleaning_status === 'done' || checkoutHK?.checkout_done
                        const hasRemark = !!booking.remarks
                        const nights = differenceInDays(parseISO(booking.checkout), parseISO(booking.checkin))
                        const firstName = booking.guest_name?.split(' ')[0] || ''
                        const showSub = width > dayW * 1.15

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
                              background: cleaned ? C.blockDone : C.block,
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
                              backdropFilter: 'blur(12px)',
                              WebkitBackdropFilter: 'blur(12px)',
                              transition: 'transform 0.14s ease, opacity 0.14s ease',
                            }}
                            onMouseEnter={e => {
                              e.currentTarget.style.opacity = '0.94'
                              e.currentTarget.style.transform = 'translateY(-1px)'
                            }}
                            onMouseLeave={e => {
                              e.currentTarget.style.opacity = '1'
                              e.currentTarget.style.transform = 'translateY(0)'
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                              <span style={cal.bookingName}>{firstName}</span>
                              {hasRemark && <span style={cal.bookingRemarkDot}>●</span>}
                            </div>
                            {startsBeforeWeek && <div style={cal.continuesLeft} />}
                            {endsAfterWeek && <div style={cal.continuesRight} />}

                            {showSub && (
                              <div style={cal.bookingSub}>
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

            <div style={cal.legend}>
              {[[C.block, 'Bokning'], [C.blockDone, 'Städat'], ['rgba(246,183,60,0.18)', 'Långtidsboende'], [C.amber, '● Meddelande']].map(([color, label]) => (
                <div key={label} style={cal.legendItem}>
                  {label.startsWith('●')
                    ? <span style={{ color, fontSize: 11 }}>●</span>
                    : <div style={{ width: 26, height: 12, borderRadius: 999, background: color, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.45)' }} />}
                  <span style={cal.legendText}>{label.replace('● ', '')}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function BookingModal({ booking: b, rooms, housekeeping, onClose, onToggleCleaning, onUpsertHK, todayStr }) {
  const room = rooms.find(r => r.id === b.room_id)
  const hk = housekeeping[`${b.room_id}_${todayStr}`]
  const isOut = b.checkout === todayStr
  const isIn = b.checkin === todayStr
  const nights = differenceInDays(parseISO(b.checkout), parseISO(b.checkin))
  const statusLabel = isOut ? 'Utcheckning idag' : isIn ? 'Incheckning idag' : 'Bor kvar'
  const statusColor = isOut ? C.red : isIn ? C.blue : C.purple

  return (
    <div style={m.overlay} onClick={onClose}>
      <div style={m.sheet} onClick={e => e.stopPropagation()}>
        <div style={m.top}>
          <div style={{ ...m.statusBadge, background: `${statusColor}22`, color: statusColor }}>
            {statusLabel}
          </div>
          <button style={m.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div style={m.hero}>
          <div style={m.heroRoom}>{room?.name || `Rum ${b.room_id}`}</div>
          <div style={m.heroGuest}>{b.guest_name}</div>
          <div style={m.heroSub}>{room?.type}</div>
        </div>

        <div style={m.grid}>
          <InfoTile label="Incheckning" value={fmtFull(b.checkin)} />
          <InfoTile label="Utcheckning" value={fmtFull(b.checkout)} />
          <InfoTile label="Nätter" value={nights} />
          <InfoTile label="Gäster" value={`${b.people} pers.`} />
          <InfoTile label="Bokningsnr" value={`#${b.multi_room_original_id || b.id}`} wide />
          {b.price && <InfoTile label="Pris" value={b.price} />}
        </div>

        {b.remarks && (
          <div style={m.remark}>
            <div style={m.remarkLabel}><span style={{ color: C.amber }}>●</span> Meddelande från gäst</div>
            <div style={m.remarkText}>{b.remarks.replace(/&#39;/g, "'")}</div>
          </div>
        )}

        {(isOut || isIn) && (
          <div style={m.actions}>
            {isOut && (
              <>
                <ModalBtn
                  label={hk?.cleaning_status === 'done' ? '✓ Städning klar' : hk?.cleaning_status === 'in_progress' ? 'Städar…' : 'Markera städat'}
                  done={hk?.cleaning_status === 'done'}
                  active={hk?.cleaning_status === 'in_progress'}
                  onClick={() => onToggleCleaning(b.room_id, todayStr)}
                />
                <ModalBtn
                  label={hk?.checkout_done ? '✓ Utcheckad' : 'Markera utcheckad'}
                  done={hk?.checkout_done}
                  onClick={() => onUpsertHK(b.room_id, todayStr, { checkout_done: !hk?.checkout_done })}
                />
              </>
            )}
            {isIn && (
              <ModalBtn
                label={hk?.checkin_done ? '✓ Incheckad' : 'Markera incheckad'}
                done={hk?.checkin_done}
                onClick={() => onUpsertHK(b.room_id, todayStr, { checkin_done: !hk?.checkin_done })}
              />
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
    <button
      onClick={onClick}
      style={{
        fontSize: 12,
        padding: '10px 16px',
        border: '1px solid rgba(255,255,255,0.7)',
        borderRadius: 999,
        background: done ? C.greenSoft : active ? C.amberSoft : 'rgba(255,255,255,0.62)',
        cursor: 'pointer',
        color: done ? C.green : active ? '#ae7b13' : C.text,
        fontWeight: 600,
        boxShadow: C.shadowSoft,
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
      }}
    >
      {label}
    </button>
  )
}

function StatTile({ icon, label, value, color, done }) {
  return (
    <div style={{ ...p.statTile, ...(done ? { background: 'rgba(244,255,249,0.72)' } : {}) }}>
      <div style={{ ...p.statIcon, color }}>{icon}</div>
      <div style={p.statValue}>{value}</div>
      <div style={p.statLabel}>{label}</div>
    </div>
  )
}

function TodaySection({ label, count, color, children }) {
  return (
    <div style={p.section}>
      <div style={p.sectionHead}>
        <div style={{ width: 9, height: 9, borderRadius: '50%', background: color, marginRight: 10, boxShadow: `0 0 0 7px ${color}15` }} />
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
    <div style={{ ...p.card, boxShadow: `${C.shadowSoft}, inset 0 1px 0 rgba(246,183,60,0.22)` }}>
      <div style={p.cardTop}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span style={p.cardRoom}>{room.name}</span>
          <span style={p.cardType}>{room.type}</span>
        </div>
        <span style={{ ...p.cardBadge, background: C.amberSoft, color: '#9a7118' }}>Långtidsboende</span>
      </div>
      <div style={p.cardTimes}>{period}</div>
      {room.long_term_note && (
        <div style={p.remark}>
          <span style={{ color: C.amber, marginRight: 6, fontSize: 10 }}>●</span>
          {room.long_term_note}
        </div>
      )}
    </div>
  )
}

function TodayCard({ b, rooms, type, color, onClick, children }) {
  const room = rooms.find(r => r.id === b.room_id)
  const nights = differenceInDays(parseISO(b.checkout), parseISO(b.checkin))
  return (
    <div style={{ ...p.card, boxShadow: `${C.shadowSoft}, inset 0 1px 0 ${color}22` }} onClick={onClick}>
      <div style={p.cardTop}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span style={p.cardRoom}>{room?.name || `Rum ${b.room_id}`}</span>
          <span style={p.cardType}>{room?.type}</span>
        </div>
        <span style={{ ...p.cardBadge, background: `${color}16`, color }}>
          {type === 'checkout' ? 'Utcheckning' : type === 'checkin' ? 'Incheckning' : 'Bor kvar'}
        </span>
      </div>
      <div style={p.cardGuest}>
        {b.guest_name}
        <span style={p.cardMeta}>{b.people} pers. · {nights} natt{nights !== 1 ? 'er' : ''}</span>
      </div>
      <div style={p.cardTimes}>
        {type === 'checkout' && `Checkat in ${b.checkin} · Checkar ut idag 11:00`}
        {type === 'checkin' && `Checkar in idag 14:00 · Checkar ut ${b.checkout}`}
        {type === 'stay' && `${b.checkin} → ${b.checkout}`}
      </div>
      {b.remarks && (
        <div style={p.remark}>
          <span style={{ color: C.amber, marginRight: 6, fontSize: 10 }}>●</span>
          {b.remarks.replace(/&#39;/g, "'").slice(0, 130)}{b.remarks.length > 130 ? '…' : ''}
        </div>
      )}
      {children}
    </div>
  )
}

function Btn({ label, done, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: 12,
        padding: '8px 13px',
        border: '1px solid rgba(255,255,255,0.68)',
        borderRadius: 999,
        background: done ? C.greenSoft : active ? C.amberSoft : 'rgba(255,255,255,0.72)',
        cursor: 'pointer',
        color: done ? C.green : active ? '#ae7b13' : C.muted,
        fontWeight: 600,
        boxShadow: C.shadowSoft,
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
      }}
    >
      {label}
    </button>
  )
}

function Empty({ text }) {
  return <div style={p.empty}>{text}</div>
}

const s = {
  page: {
    fontFamily: "'Inter', system-ui, sans-serif",
    minHeight: '100vh',
    background: `linear-gradient(180deg, ${C.bgTop} 0%, ${C.bgBottom} 100%)`,
    position: 'relative',
    overflow: 'hidden',
  },
  bgBlobOne: {
    position: 'fixed', top: -140, right: -80, width: 340, height: 340, borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(132, 191, 255, 0.28) 0%, rgba(132, 191, 255, 0) 72%)', pointerEvents: 'none'
  },
  bgBlobTwo: {
    position: 'fixed', bottom: -120, left: -60, width: 320, height: 320, borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(255, 214, 169, 0.24) 0%, rgba(255, 214, 169, 0) 72%)', pointerEvents: 'none'
  },
  bgBlobThree: {
    position: 'fixed', top: '34%', left: '18%', width: 220, height: 220, borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(188, 172, 255, 0.16) 0%, rgba(188, 172, 255, 0) 74%)', pointerEvents: 'none'
  },
}

const n = {
  navShell: { position: 'sticky', top: 0, zIndex: 100, padding: '14px 18px 0' },
  nav: { ...glassPanel, borderRadius: 26, background: 'rgba(255,255,255,0.72)' },
  navInner: {
    maxWidth: 1380, margin: '0 auto', padding: '14px 24px',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 18, flexWrap: 'wrap'
  },
  logo: {
    fontFamily: "'Playfair Display', Georgia, serif",
    fontSize: 32,
    fontWeight: 700,
    color: C.text,
    letterSpacing: '-0.03em',
    lineHeight: 1,
  },
  logoSub: { marginTop: 5, fontSize: 13, color: C.muted, fontWeight: 600 },
  navRight: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  tabs: {
    display: 'flex',
    background: 'rgba(255,255,255,0.52)',
    borderRadius: 999,
    padding: 5,
    border: '1px solid rgba(255,255,255,0.66)',
    boxShadow: C.shadowSoft,
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
  },
  tab: {
    padding: '10px 18px', border: 'none', background: 'transparent', borderRadius: 999,
    fontSize: 14, cursor: 'pointer', color: C.muted, fontWeight: 600, minWidth: 104,
  },
  tabActive: {
    background: 'rgba(255,255,255,0.86)',
    color: C.text,
    boxShadow: '0 4px 14px rgba(125, 145, 177, 0.18)',
  },
  signout: {
    fontSize: 13, padding: '10px 16px', border: '1px solid rgba(255,255,255,0.7)', borderRadius: 999,
    background: 'rgba(255,255,255,0.6)', cursor: 'pointer', color: C.muted, fontWeight: 600,
    boxShadow: C.shadowSoft, backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)'
  },
  content: { maxWidth: 1380, margin: '0 auto', padding: '26px 24px 88px', position: 'relative', zIndex: 1 },
}

const p = {
  viewHeader: {
    ...glassPanel,
    borderRadius: 28,
    padding: '22px 24px',
    marginBottom: 22,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 16,
    flexWrap: 'wrap',
    background: 'rgba(255,255,255,0.68)',
  },
  kicker: { fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.1em', color: C.faint, fontWeight: 700, marginBottom: 10 },
  dateText: { fontSize: 32, fontWeight: 750, color: C.text, letterSpacing: '-0.03em', textTransform: 'capitalize', lineHeight: 1.1 },
  heroChip: {
    padding: '10px 14px', borderRadius: 999, background: 'rgba(255,255,255,0.62)', color: C.muted,
    fontSize: 13, fontWeight: 600, border: '1px solid rgba(255,255,255,0.66)', boxShadow: C.shadowSoft
  },
  statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 14, marginBottom: 32 },
  statTile: {
    ...glassPanel,
    borderRadius: 24,
    padding: '18px 20px',
    minHeight: 116,
  },
  statIcon: { fontSize: 12, fontWeight: 800, marginBottom: 8, opacity: 0.9 },
  statValue: { fontSize: 30, fontWeight: 700, color: C.text, lineHeight: 1.02, letterSpacing: '-0.03em' },
  statLabel: { fontSize: 12, color: C.muted, marginTop: 8, fontWeight: 600 },
  section: { marginBottom: 30 },
  sectionHead: { display: 'flex', alignItems: 'center', marginBottom: 12 },
  sectionLabel: { fontSize: 13, fontWeight: 700, color: C.text, textTransform: 'uppercase', letterSpacing: '0.09em' },
  sectionCount: { marginLeft: 8, fontSize: 13, color: C.faint, fontWeight: 600 },
  card: {
    ...glassPanel,
    borderRadius: 24,
    padding: '18px 18px',
    background: 'rgba(255,255,255,0.70)',
    marginBottom: 10,
    cursor: 'pointer',
  },
  cardTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 6, flexWrap: 'wrap' },
  cardRoom: { fontSize: 15, fontWeight: 700, color: C.text },
  cardType: { fontSize: 12, color: C.faint, fontWeight: 500 },
  cardBadge: { fontSize: 11, fontWeight: 700, padding: '6px 10px', borderRadius: 999 },
  cardGuest: { fontSize: 17, fontWeight: 700, color: C.text, marginBottom: 4, display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' },
  cardMeta: { fontSize: 12, color: C.faint, fontWeight: 500 },
  cardTimes: { fontSize: 13, color: C.muted, marginBottom: 2 },
  remark: {
    fontSize: 12, color: '#8b6a19', background: 'rgba(255, 247, 226, 0.7)', border: '1px solid rgba(255, 226, 165, 0.8)',
    borderRadius: 16, padding: '8px 11px', marginTop: 10, lineHeight: 1.5
  },
  actions: { display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' },
  empty: { ...glassPanel, borderRadius: 20, fontSize: 13, color: C.faint, padding: '14px 16px' },
}

const cal = {
  nav: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, marginBottom: 18, flexWrap: 'wrap' },
  titleWrap: { textAlign: 'center', flex: 1, minWidth: 280 },
  kicker: { fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.1em', color: C.faint, fontWeight: 700, marginBottom: 8 },
  title: { fontFamily: "'Inter', system-ui, sans-serif", fontSize: 32, fontWeight: 750, color: C.text, letterSpacing: '-0.03em' },
  navBtn: {
    fontSize: 14, padding: '11px 18px', border: '1px solid rgba(255,255,255,0.68)', borderRadius: 999,
    background: 'rgba(255,255,255,0.62)', cursor: 'pointer', color: C.text, fontWeight: 600,
    boxShadow: C.shadowSoft, backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)'
  },
  wrap: { ...glassPanel, borderRadius: 28, overflow: 'hidden', width: '100%', background: 'rgba(255,255,255,0.64)' },
  headerRow: { display: 'flex', borderBottom: `1px solid ${C.lineStrong}`, background: 'rgba(255,255,255,0.28)' },
  todayDot: { width: 6, height: 6, borderRadius: '50%', background: C.blue, margin: '6px auto 0', boxShadow: '0 0 0 5px rgba(79,141,247,0.12)' },
  row: {
    display: 'flex', height: ROW_HEIGHT, borderBottom: `1px solid ${C.line}`,
    background: 'rgba(255,255,255,0.28)', position: 'relative'
  },
  roomLabel: {
    width: `${ROOM_COL_PCT}%`, flexShrink: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center',
    padding: '0 14px', borderRight: `1px solid ${C.line}`, background: 'rgba(255,255,255,0.34)'
  },
  roomName: { fontSize: 13, fontWeight: 700, color: C.text },
  roomType: { fontSize: 11, color: C.faint, marginTop: 3 },
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
  longTermBanner: {
    ...glassPanel,
    background: 'rgba(255,248,220,0.68)',
    borderRadius: 18,
    padding: '11px 14px',
    margin: '-8px 0 16px',
    color: '#8a6416',
    fontSize: 13,
    fontWeight: 600,
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
    boxShadow: '0 0 12px rgba(255,255,255,0.7)',
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
    boxShadow: '0 0 12px rgba(255,255,255,0.7)',
    pointerEvents: 'none',
  },
  legend: { display: 'flex', gap: 16, marginTop: 16, flexWrap: 'wrap', alignItems: 'center' },
  legendItem: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderRadius: 999,
    background: 'rgba(255,255,255,0.56)', border: '1px solid rgba(255,255,255,0.64)', boxShadow: C.shadowSoft
  },
  legendText: { fontSize: 12, color: C.muted, fontWeight: 600 },
}

const m = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(162, 178, 207, 0.20)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 200, padding: 16, backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)'
  },
  sheet: {
    background: 'rgba(255,255,255,0.72)', borderRadius: 28, width: '100%', maxWidth: 470,
    boxShadow: '0 30px 70px rgba(80, 96, 126, 0.2)', overflow: 'hidden', maxHeight: '90vh', overflowY: 'auto',
    border: '1px solid rgba(255,255,255,0.8)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)'
  },
  top: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 20px 0' },
  statusBadge: { fontSize: 11, fontWeight: 700, padding: '6px 12px', borderRadius: 999, letterSpacing: '0.04em' },
  closeBtn: {
    background: 'rgba(255,255,255,0.68)', border: '1px solid rgba(255,255,255,0.8)', width: 34, height: 34,
    borderRadius: '50%', fontSize: 16, color: C.muted, cursor: 'pointer', lineHeight: 1, boxShadow: C.shadowSoft
  },
  hero: { padding: '16px 20px 18px', borderBottom: `1px solid ${C.line}` },
  heroRoom: { fontSize: 13, fontWeight: 600, color: C.muted, marginBottom: 5 },
  heroGuest: { fontSize: 28, fontWeight: 700, color: C.text, letterSpacing: '-0.03em', lineHeight: 1.15 },
  heroSub: { fontSize: 13, color: C.faint, marginTop: 5 },
  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, padding: '18px 20px' },
  tile: {
    background: 'rgba(255,255,255,0.5)', borderRadius: 18, padding: '12px 13px', border: '1px solid rgba(255,255,255,0.7)',
    boxShadow: C.shadowSoft
  },
  tileLabel: { fontSize: 10, fontWeight: 700, color: C.faint, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 },
  tileValue: { fontSize: 13, fontWeight: 700, color: C.text },
  remark: {
    margin: '0 20px 16px', background: 'rgba(255,247,226,0.75)', border: '1px solid rgba(255,226,165,0.9)',
    borderRadius: 18, padding: '12px 14px'
  },
  remarkLabel: { fontSize: 11, fontWeight: 700, color: '#8b6a19', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 },
  remarkText: { fontSize: 13, color: C.text, lineHeight: 1.6 },
  actions: { display: 'flex', gap: 8, padding: '0 20px 18px', flexWrap: 'wrap' },
  footer: { padding: '12px 20px 20px', borderTop: `1px solid ${C.line}` },
  closeFooter: {
    width: '100%', padding: '12px', border: '1px solid rgba(255,255,255,0.8)', borderRadius: 999,
    background: 'rgba(255,255,255,0.66)', fontSize: 13, fontWeight: 600, cursor: 'pointer', color: C.muted,
    boxShadow: C.shadowSoft
  },
}
