'use client'
import React, { useState, useMemo, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { TicketWithExtras } from '@/lib/data'
import RedispatchModal, { type ParcelForRedispatch } from './RedispatchModal'

// ── rep list (hardcoded per request; update here to change) ──
const REPS = ['Swara', 'Taslima', 'Tanvi mam'] as const

// ── pipeline config (display) ──
const PIPELINES: Record<string, string[]> = {
  delivery_delayed: ['verify_address', 'verify_pincode', 'verify_phone', 'contact_customer', 'resolution'],
  missing_item: ['verify_photo', 'verify_video', 'verify_from_factory', 'file_claim', 'resolution'],
  wrong_item: ['verify_photo', 'verify_video', 'verify_from_factory', 'file_claim', 'resolution'],
  damaged_item: ['verify_photo', 'verify_video', 'identify_quantity', 'file_claim', 'resolution'],
  delivered_not_received: ['check_tracking', 'contact_customer', 'file_claim', 'resolution'],
}
const STAGE_ACTION: Record<string, { label: string; capture: string }> = {
  verify_address: { label: 'Verify Address', capture: 'confirm' },
  verify_pincode: { label: 'Verify Pincode', capture: 'confirm' },
  verify_phone: { label: 'Verify Phone', capture: 'confirm' },
  contact_customer: { label: 'Contact Customer', capture: 'contact' },
  check_tracking: { label: 'Confirm Proof of Delivery', capture: 'pod' },
  verify_photo: { label: 'Verify Photo', capture: 'review' },
  verify_video: { label: 'Verify Video', capture: 'review' },
  verify_from_factory: { label: 'Verify Dispatch with Factory', capture: 'dispatched' },
  identify_quantity: { label: 'Record Damaged Qty & Value', capture: 'qtyval' },
  file_claim: { label: 'File Claim', capture: 'claim' },
  resolution: { label: 'Resolution', capture: 'resolve' },
}
const STAGE_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(STAGE_ACTION).map(([k, v]) => [k, v.label]),
)
const TYPE_LABEL: Record<string, string> = {
  delivery_delayed: 'Delivery Delayed', damaged_item: 'Damaged Item',
  delivered_not_received: 'Delivered Not Received', missing_item: 'Missing Item', wrong_item: 'Wrong Item',
}
const EVIDENCE_TYPES = new Set(['damaged_item', 'wrong_item', 'missing_item'])

// ── courier-aware tracking identifier ──
function trackingFor(courier: string | null | undefined, d: { tracking_id?: string | null; tracking_identifier?: string | null; barcode?: string | null; tracking_number?: string | null }) {
  if (d.tracking_identifier) return d.tracking_identifier
  if (courier === 'Mahavir' || courier === 'IndiaPost' || courier == null) return d.barcode ?? null
  return d.tracking_id ?? d.tracking_number ?? null
}

const statusBadge = (s: string) => ({
  open: 'bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700',
  in_progress: 'bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800',
  awaiting_information: 'bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800',
  closed: 'bg-green-100 text-green-700 border-green-300 dark:bg-green-950 dark:text-green-300 dark:border-green-800',
}[s] || 'bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700')
const statusText = (s: string) => ({ open: 'Open', in_progress: 'In Progress', awaiting_information: 'Awaiting Info', closed: 'Closed' }[s] || s)
const typeBadge = (t: string) => ({
  delivery_delayed: 'bg-indigo-100 text-indigo-700 border-indigo-300 dark:bg-indigo-950 dark:text-indigo-300 dark:border-indigo-800',
  delivered_not_received: 'bg-orange-100 text-orange-700 border-orange-300 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-800',
  damaged_item: 'bg-red-100 text-red-700 border-red-300 dark:bg-red-950 dark:text-red-300 dark:border-red-800',
  wrong_item: 'bg-red-100 text-red-700 border-red-300 dark:bg-red-950 dark:text-red-300 dark:border-red-800',
  missing_item: 'bg-purple-100 text-purple-700 border-purple-300 dark:bg-purple-950 dark:text-purple-300 dark:border-purple-800',
}[t] || 'bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700')
const rupee = (n: number | null | undefined) => n == null ? '—' : '₹' + Number(n).toLocaleString('en-IN')
const daysSince = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
const ageLabel = (iso: string) => { const d = daysSince(iso); return d === 0 ? 'today' : `${d}d` }
const fmtAgo = (iso: string) => {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  return m >= 1440 ? `${Math.floor(m / 1440)}d ago` : m >= 60 ? `${Math.floor(m / 60)}h ago` : `${m}m ago`
}

function Pill({ className, children }: { className: string; children: React.ReactNode }) {
  return <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${className}`}>{children}</span>
}

// ── theme hook: light default, persisted, toggled by adding/removing `dark` on <html> ──
function useTheme() {
  const [dark, setDark] = useState(false)
  useEffect(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem('hugg-theme') : null
    const isDark = saved === 'dark'
    setDark(isDark)
    document.documentElement.classList.toggle('dark', isDark)
  }, [])
  const toggle = useCallback(() => {
    setDark(prev => {
      const next = !prev
      document.documentElement.classList.toggle('dark', next)
      try { window.localStorage.setItem('hugg-theme', next ? 'dark' : 'light') } catch {}
      return next
    })
  }, [])
  return { dark, toggle }
}

export default function Console({ initialTickets }: { initialTickets: TicketWithExtras[] }) {
  const router = useRouter()
  const { dark, toggle } = useTheme()
  const [filter, setFilter] = useState('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [repFilter, setRepFilter] = useState('all')
  const [sortBy, setSortBy] = useState<'urgent' | 'newest'>('urgent')
  const tickets = initialTickets

  async function logout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/auth/login')
    router.refresh()
  }

  const counts = useMemo(() => {
    const c = { total: tickets.length, open: 0, in_progress: 0, awaiting_information: 0, closed: 0, mine: 0 } as Record<string, number>
    tickets.forEach((t) => { c[t.ticket_status]++; if (t.currently_handled_by === 'human' && t.ticket_status !== 'closed') c.mine++ })
    return c
  }, [tickets])

  const filtered = useMemo(() => {
    let rows = [...tickets]
    if (filter === 'mine') rows = rows.filter((t) => t.currently_handled_by === 'human' && t.ticket_status !== 'closed')
    else if (filter !== 'all') rows = rows.filter((t) => t.ticket_status === filter)
    if (typeFilter !== 'all') rows = rows.filter((t) => t.complaint_type === typeFilter)
    if (repFilter !== 'all') rows = rows.filter((t) => (t.assigned_rep_name || '') === (repFilter === 'unassigned' ? '' : repFilter))
    if (query.trim()) {
      const q = query.toLowerCase()
      rows = rows.filter((t) => t.ticket_number.toLowerCase().includes(q) || String(t.order_id).includes(q) || (t.order?.customer_name || '').toLowerCase().includes(q))
    }
    // sort
    if (sortBy === 'urgent') {
      const rank = (t: TicketWithExtras) => {
        if (t.ticket_status === 'closed') return 0
        let r = 1
        if (t.ticket_status === 'awaiting_information') r += 2
        if (daysSince(t.created_at) > 7) r += 4
        if (t.currently_handled_by === 'human') r += 1
        return r
      }
      rows.sort((a, b) => rank(b) - rank(a) || (new Date(b.created_at).getTime() - new Date(a.created_at).getTime()))
    } else {
      rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    }
    return rows
  }, [tickets, filter, typeFilter, repFilter, query, sortBy])

  const selected = tickets.find((t) => t.id === selectedId) || null

  const card = 'rounded-xl border bg-white border-gray-200 dark:bg-gray-900 dark:border-gray-800'

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100" style={{ fontFamily: 'Outfit, ui-sans-serif, system-ui, sans-serif' }}>
      {/* header */}
      <div className="border-b border-gray-200 bg-white dark:bg-gray-900 dark:border-gray-800 px-6 py-3 flex items-center gap-3">
        <span className="font-semibold">Hugg Support</span>
        <Pill className="bg-[rgb(85,185,131)] text-white border-[rgb(85,185,131)]">Complaints {tickets.length}</Pill>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={toggle} title="Toggle theme" className="rounded-lg border border-gray-300 dark:border-gray-700 px-2.5 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800">
            {dark ? '☀️' : '🌙'}
          </button>
          <button onClick={logout} className="rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800">Logout</button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-5">
        {/* scorecards */}
        <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 mb-5">
          {([['Total', 'all', 'total'], ['Open', 'open', 'open'], ['In Progress', 'in_progress', 'in_progress'], ['Awaiting Info', 'awaiting_information', 'awaiting_information'], ['Closed', 'closed', 'closed'], ['In Progress (human)', 'mine', 'mine']] as const).map(([label, key, ckey]) => (
            <button key={key} onClick={() => setFilter(key)} className={`text-left rounded-xl border px-3 py-2.5 transition hover:shadow-sm bg-white border-gray-200 dark:bg-gray-900 dark:border-gray-800 ${filter === key ? 'ring-2 ring-[rgb(85,185,131)] ring-offset-1 dark:ring-offset-gray-950' : ''}`}>
              <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
              <div className="text-xl font-semibold">{counts[ckey]}</div>
            </button>
          ))}
        </div>

        {/* filters row */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search ticket #, order ID, customer…"
            className="w-full sm:w-72 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[rgb(85,185,131)]" />
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-2 text-sm">
            <option value="all">All types</option>
            {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={repFilter} onChange={(e) => setRepFilter(e.target.value)} className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-2 text-sm">
            <option value="all">All reps</option>
            <option value="unassigned">Unassigned</option>
            {REPS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as 'urgent' | 'newest')} className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-2 text-sm">
            <option value="urgent">Sort: Urgent first</option>
            <option value="newest">Sort: Newest first</option>
          </select>
          <span className="ml-auto text-xs text-gray-500 dark:text-gray-400">{filtered.length} of {tickets.length}</span>
        </div>

        {/* queue */}
        <div className={`${card} overflow-hidden`}>
          <div className="grid grid-cols-12 gap-2 px-4 py-2 text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/60">
            <div className="col-span-3">Ticket</div><div className="col-span-3">Details</div>
            <div className="col-span-2">Rep</div><div className="col-span-1">Age</div><div className="col-span-3 text-right">Status</div>
          </div>
          {filtered.map((t) => {
            const d0 = t.deliveries?.[0]
            const overdue = daysSince(t.created_at) > 7 && t.ticket_status !== 'closed'
            return (
              <button key={t.id} onClick={() => setSelectedId(t.id)} className="w-full grid grid-cols-12 gap-2 px-4 py-3 text-left items-center border-b border-gray-50 dark:border-gray-800/60 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors">
                <div className="col-span-3">
                  <div className="font-medium text-sm flex items-center gap-1.5">
                    {overdue && <span className="h-1.5 w-1.5 rounded-full bg-red-500 shrink-0" title="Over 7 days" />}
                    {t.ticket_number}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">#{t.order_id} · {t.order?.customer_name || '—'}</div>
                </div>
                <div className="col-span-3 flex items-center gap-2 flex-wrap">
                  <Pill className={typeBadge(t.complaint_type)}>{TYPE_LABEL[t.complaint_type]}</Pill>
                  <span className="text-xs text-gray-600 dark:text-gray-400 truncate">{d0?.product_name}</span>
                </div>
                <div className="col-span-2 text-xs">
                  {t.assigned_rep_name
                    ? <span className="font-medium text-[rgb(85,185,131)]">{t.assigned_rep_name}</span>
                    : <span className="text-gray-400">unassigned</span>}
                </div>
                <div className={`col-span-1 text-xs ${overdue ? 'text-red-600 dark:text-red-400 font-medium' : 'text-gray-500 dark:text-gray-400'}`}>{ageLabel(t.created_at)}</div>
                <div className="col-span-3 flex justify-end"><Pill className={statusBadge(t.ticket_status)}>{statusText(t.ticket_status)}</Pill></div>
              </button>
            )
          })}
          {filtered.length === 0 && <div className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">No tickets match. Try a different filter.</div>}
        </div>
      </div>

      {selected && <TicketPanel key={selected.id} t={selected} onClose={() => setSelectedId(null)} />}
    </div>
  )
}

function TicketPanel({ t, onClose }: { t: TicketWithExtras; onClose: () => void }) {
  const router = useRouter()
  const actions = t.actions || []
  const isEvidence = EVIDENCE_TYPES.has(t.complaint_type)
  const isDNR = t.complaint_type === 'delivered_not_received'
  const isDelay = t.complaint_type === 'delivery_delayed'
  const stages = PIPELINES[t.complaint_type] || []

  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [redispatchParcels, setRedispatchParcels] = useState<ParcelForRedispatch[] | null>(null)
  const [redispatchParcel, setRedispatchParcel] = useState<ParcelForRedispatch | null>(null)
  const [loadingParcels, setLoadingParcels] = useState(false)
  const [refundMode, setRefundMode] = useState<string | null>(null)
  const [refundKind, setRefundKind] = useState('coupon')
  const [refundAmt, setRefundAmt] = useState(t.damaged_value != null ? String(t.damaged_value) : '')
  const [resolveMode, setResolveMode] = useState(false)
  const [showRespond, setShowRespond] = useState(false)
  const [respondNote, setRespondNote] = useState('')
  const [stagePanel, setStagePanel] = useState(false)
  const [rep, setRep] = useState(t.assigned_rep_name || '')

  // ── live delivery records from public.delivery (by order_id) ──
  const [deliveries, setDeliveries] = useState<ParcelForRedispatch[] | null>(null)
  const [delLoading, setDelLoading] = useState(true)
  useEffect(() => {
    let alive = true
    setDelLoading(true)
    fetch(`/api/complaints/${t.id}/deliveries`).then(r => r.json()).then(d => {
      if (!alive) return
      setDeliveries(d.ok ? (d.deliveries ?? []) : [])
      setDelLoading(false)
    }).catch(() => { if (alive) { setDeliveries([]); setDelLoading(false) } })
    return () => { alive = false }
  }, [t.id])

  const courierClaim = deliveries?.[0]?.complaint_status_message || (t.deliveries?.[0]?.status_message) || ''
  const courierName = deliveries?.[0]?.assigned_courier || t.deliveries?.[0]?.courier || 'courier'

  const curStage = t.current_stage
  const stageMeta = curStage ? STAGE_ACTION[curStage] : null
  const isAwaiting = t.ticket_status === 'awaiting_information'

  async function call(path: string, body: Record<string, unknown>, okMsg?: string) {
    setBusy(true); setMsg(null); setOk(null)
    try {
      const res = await fetch(`/api/complaints/${t.id}/${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!data.ok) { setMsg(data.reason || 'Action failed'); setBusy(false); return false }
      if (okMsg) setOk(okMsg)
      router.refresh()
      setBusy(false); return true
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Request failed'); setBusy(false); return false
    }
  }

  async function openRedispatch() {
    setLoadingParcels(true); setMsg(null)
    try {
      // reuse already-loaded deliveries if present
      const parcels = deliveries ?? (await (await fetch(`/api/complaints/${t.id}/deliveries`)).json()).deliveries ?? []
      if (parcels.length === 0) { setMsg('No shipping records found for this order — cannot redispatch.'); setLoadingParcels(false); return }
      if (parcels.length === 1) setRedispatchParcel(parcels[0])
      else setRedispatchParcels(parcels)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Failed to load deliveries')
    } finally { setLoadingParcels(false) }
  }

  async function saveRep(name: string) {
    setRep(name)
    await call('assign-rep', { rep: name || null }, name ? `Assigned to ${name}` : 'Rep cleared')
  }

  const nextStage = (key: string) => { const i = stages.indexOf(key); return stages[i + 1] || key }

  const card = 'rounded-xl border border-gray-200 dark:border-gray-800'
  const sub = 'text-gray-500 dark:text-gray-400'
  const btnGhost = 'rounded-lg px-3 py-1.5 text-sm font-medium border bg-white text-gray-700 border-gray-300 hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-200 dark:border-gray-700 dark:hover:bg-gray-800 disabled:opacity-50'

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto" onClick={onClose}>
      <div className="w-full max-w-3xl my-4 rounded-xl bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow-xl" onClick={(e) => e.stopPropagation()} style={{ fontFamily: 'Outfit, ui-sans-serif, system-ui, sans-serif' }}>
        {/* header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="font-semibold text-lg">{t.ticket_number}</span>
            <Pill className={typeBadge(t.complaint_type)}>{TYPE_LABEL[t.complaint_type]}</Pill>
            <span className={`text-xs ${sub}`}>{t.raised_by?.replace('_', ' + ')} · {ageLabel(t.created_at)} old</span>
          </div>
          <div className="flex items-center gap-2">
            {/* rep dropdown */}
            <select value={rep} onChange={(e) => saveRep(e.target.value)} disabled={busy}
              className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 text-xs">
              <option value="">Unassigned</option>
              {REPS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <Pill className={statusBadge(t.ticket_status)}>{statusText(t.ticket_status)}</Pill>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-xl leading-none px-1">×</button>
          </div>
        </div>

        {msg && <div className="mx-5 mt-3 rounded-lg bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">{msg}</div>}
        {ok && <div className="mx-5 mt-3 rounded-lg bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 px-3 py-2 text-xs text-green-800 dark:text-green-300">{ok}</div>}

        <div className="p-5 space-y-4">
          {/* PART 1 */}
          <Section title="Who · what · how long">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Field label="Customer" value={t.order?.customer_name} sub={`${t.shipping_city || ''}${t.shipping_state ? ', ' + t.shipping_state : ''}`} />
              <Field label="Order" value={'#' + t.order_id} sub={rupee(t.order?.order_total)} />
              <Field label="Payment" value={t.order?.payment_method === 'cod' ? 'COD' : t.order?.payment_method ? 'Prepaid' : '—'} sub={t.order?.payment_method || undefined} />
              <Field label="Days open" value={ageLabel(t.created_at)} sub={t.awaiting_since ? 'awaiting response' : undefined} danger={daysSince(t.created_at) > 7} />
            </div>

            {isDelay && (
              <div className="mt-3 rounded-lg bg-gray-50 dark:bg-gray-800/50 p-3">
                <div className={`text-[11px] uppercase tracking-wide ${sub} mb-1`}>Delivery address & phone</div>
                {t.updated_address ? (
                  <div className="space-y-1.5">
                    <div className="flex items-start gap-2 text-sm"><span className="text-xs text-gray-400 w-16 shrink-0 mt-0.5">Original</span><span className="text-gray-500 dark:text-gray-400 line-through">{t.shipping_address}, {t.shipping_city}, {t.shipping_state} {t.shipping_postcode}</span></div>
                    <div className="flex items-start gap-2 text-sm"><span className="text-xs text-amber-600 dark:text-amber-400 w-16 shrink-0 mt-0.5 font-medium">Updated</span><span className="font-medium">{t.updated_address}</span></div>
                    <div className="text-xs text-amber-600 dark:text-amber-400">⚠ Customer corrected the address — check whose error before redispatch.</div>
                  </div>
                ) : (
                  <div className="text-sm">{t.shipping_address}, {t.shipping_city}, {t.shipping_state} — {t.shipping_postcode}</div>
                )}
                {t.customer_phone && <div className="text-sm mt-1">📞 {t.customer_phone}</div>}
              </div>
            )}

            <div className="mt-3 flex items-center gap-3 text-xs">
              <span className={sub}>Handled by</span>
              <Pill className={t.currently_handled_by === 'human' ? 'bg-gray-900 text-white border-gray-900 dark:bg-gray-100 dark:text-gray-900 dark:border-gray-100' : 'bg-gray-100 text-gray-600 border-gray-300 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700'}>{t.currently_handled_by}</Pill>
              {t.currently_handled_by === 'system' && <span className="text-gray-400">— not yet handed to a human</span>}
            </div>

            {t.currently_handled_by === 'human' && (
              <div className="mt-4">
                <div className={`text-xs font-medium ${sub} mb-2`}>Pipeline</div>
                <div className="flex items-center gap-1 flex-wrap">
                  {stages.map((s, i) => {
                    const curIdx = stages.indexOf(t.current_stage || '')
                    const done = i < curIdx || t.ticket_status === 'closed'
                    const cur = s === t.current_stage && t.ticket_status !== 'closed'
                    return (
                      <React.Fragment key={s}>
                        {i > 0 && <span className="text-gray-300 dark:text-gray-600">›</span>}
                        <span className={`text-xs px-2 py-1 rounded-md border ${cur ? 'bg-blue-50 text-blue-700 border-blue-300 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800 font-medium' : done ? 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800' : 'bg-gray-50 text-gray-400 border-gray-200 dark:bg-gray-800 dark:text-gray-500 dark:border-gray-700'}`}>
                          {done && !cur ? '✓ ' : ''}{STAGE_LABEL[s]}
                        </span>
                      </React.Fragment>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="mt-4 border-t border-gray-100 dark:border-gray-800 pt-3">
              <div className={`text-xs font-medium ${sub} mb-2`}>What&apos;s happened so far</div>
              {actions.length === 0 ? <p className="text-xs text-gray-400">No actions logged yet.</p> : (
                <ol className="space-y-2">
                  {actions.map((a) => (
                    <li key={a.id} className="flex items-start gap-2 text-xs">
                      <span className={`mt-1 h-1.5 w-1.5 rounded-full shrink-0 ${a.action_by === 'human' ? 'bg-gray-800 dark:bg-gray-200' : 'bg-gray-400'}`} />
                      <span className="text-gray-400 tabular-nums shrink-0 w-16">{fmtAgo(a.created_at)}</span>
                      <span className="font-medium">{a.action_type.replace(/_/g, ' ')}</span>
                      <span className="text-gray-400">· {a.action_by}</span>
                      {a.notes && <span className={sub}>— {a.notes}</span>}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </Section>

          {/* PART 2 — delivery records (TV-style, from public.delivery) */}
          <Section title={isDNR ? "What's disputed" : isEvidence ? 'What the customer reported' : 'Delivery records (live)'}>
            {isDNR ? (
              <div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg bg-gray-50 dark:bg-gray-800/50 border-l-2 border-blue-300 p-3"><div className={`text-xs font-medium ${sub} mb-1`}>Courier says</div><div className="text-sm font-medium">Delivered</div><div className={`text-xs ${sub} mt-1`}>{courierClaim}</div></div>
                  <div className="rounded-lg bg-gray-50 dark:bg-gray-800/50 border-l-2 border-amber-300 p-3"><div className={`text-xs font-medium ${sub} mb-1`}>Customer says</div><div className="text-sm font-medium text-amber-700 dark:text-amber-400">Not received</div><div className={`text-xs ${sub} mt-1`}>{t.image_url || t.video_url ? 'Evidence attached' : 'No photo/video — parcel never arrived'}</div></div>
                </div>
                <p className={`text-xs ${sub} mt-3`}>Order {rupee(t.order?.order_total)} — decides whether to dispute with the courier or refund directly.</p>
                <DeliveryRecords deliveries={deliveries} loading={delLoading} sub={sub} card={card} />
              </div>
            ) : isEvidence ? (
              <div className="space-y-2 text-sm">
                <p>Customer reports a <strong>{TYPE_LABEL[t.complaint_type].toLowerCase()}</strong> issue{t.missing_items ? `: ${t.missing_items}` : ''}.</p>
                <div className="flex gap-3 text-xs">
                  {t.image_url && <a href={t.image_url} target="_blank" className="text-[rgb(85,185,131)] underline">View photo</a>}
                  {t.video_url && <a href={t.video_url} target="_blank" className="text-[rgb(85,185,131)] underline">View video</a>}
                  {!t.image_url && !t.video_url && <span className="text-gray-400">No evidence attached.</span>}
                </div>
                {t.complaint_type === 'damaged_item' && (
                  <div className={`text-xs ${sub} mt-1`}>{t.damaged_qty != null ? `${t.damaged_qty} unit(s) damaged · ${rupee(t.damaged_value)}` : <span className="text-amber-600 dark:text-amber-400">Quantity + value not yet recorded</span>}</div>
                )}
                <DeliveryRecords deliveries={deliveries} loading={delLoading} sub={sub} card={card} />
              </div>
            ) : (
              <DeliveryRecords deliveries={deliveries} loading={delLoading} sub={sub} card={card} />
            )}
          </Section>

          {/* PART 3 — actions */}
          <Section title="What to do now">
            {t.ticket_status === 'closed' ? (
              <div className="rounded-lg bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 p-3 text-sm">
                <div className="font-medium text-green-800 dark:text-green-300">Resolved · {t.resolution_method?.replace(/_/g, ' ')}</div>
                <div className="text-xs text-green-700 dark:text-green-400 mt-1">By {t.resolved_by} · fault: {t.fault_attribution}{t.resolution_notes ? ` — ${t.resolution_notes}` : ''}</div>
              </div>
            ) : t.currently_handled_by === 'system' ? (
              <div className={`rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 p-3 text-sm ${sub}`}>
                System is monitoring this delivery. It hands off to a human if attempts exceed 2 or the order passes 7 days.
                {daysSince(t.created_at) > 7 && <span className="block mt-1 text-amber-700 dark:text-amber-400 font-medium">⚠ Over 7 days — due for handoff.</span>}
                <div className="mt-2"><button disabled={busy} onClick={() => call('assign', { force: true, reason: 'manual handoff' })} className="rounded bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 px-3 py-1 text-xs font-medium disabled:opacity-50">Hand off to human now</button></div>
              </div>
            ) : (
              <div className="space-y-3">
                {isAwaiting && (
                  <div className="rounded-lg bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 p-3">
                    <div className="text-sm font-medium text-amber-800 dark:text-amber-300">✓ Escalated to {courierName} · awaiting response</div>
                    {!showRespond ? (
                      <button onClick={() => setShowRespond(true)} className="mt-2 text-xs font-medium text-amber-800 dark:text-amber-300 underline">Courier responded?</button>
                    ) : (
                      <div className="mt-2 space-y-2">
                        <input value={respondNote} onChange={(e) => setRespondNote(e.target.value)} placeholder="What did the courier say?" className="w-full rounded border border-amber-300 dark:border-amber-700 bg-white dark:bg-gray-900 px-2 py-1.5 text-sm focus:outline-none" />
                        <div className="flex gap-2">
                          <button disabled={busy} onClick={async () => { if (await call('respond', { note: respondNote })) { setShowRespond(false); setRespondNote('') } }} className="rounded bg-amber-600 text-white px-3 py-1 text-xs font-medium disabled:opacity-50">Save &amp; reopen</button>
                          <button onClick={() => setShowRespond(false)} className="text-xs text-gray-500">Cancel</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {stageMeta && curStage && curStage !== 'resolution' && (
                  <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/40 p-3">
                    <div className="text-xs font-medium text-blue-700 dark:text-blue-300 mb-2">Current step{nextHint(t, curStage) ? ` — ${nextHint(t, curStage)}` : ''}</div>
                    {stagePanel ? (
                      <StageCapture meta={stageMeta} stageKey={curStage} busy={busy}
                        onDone={async (note, extra) => {
                          if (curStage === 'file_claim') await call('file-claim', { note }, 'Claim filed — sent to n8n.')
                          const okAdv = await call('advance', { to: nextStage(curStage), completing: curStage, action_type: curStage, action_by: 'human', notes: note, ...extra })
                          if (okAdv) setStagePanel(false)
                        }} onCancel={() => setStagePanel(false)} />
                    ) : (
                      <button onClick={() => setStagePanel(true)} className="rounded-lg bg-[rgb(85,185,131)] text-white px-3 py-1.5 text-sm font-medium hover:opacity-90">{stageMeta.label}</button>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  {isDelay && !isAwaiting && <button disabled={busy} onClick={() => call('escalate-courier', {}, 'Escalated to courier — sent to n8n.')} className={btnGhost}>Escalate to courier</button>}
                  {isDelay && <button disabled={busy} onClick={() => call('reverify-address', {}, 'Reverify link sent — n8n will message the customer.')} className={btnGhost}>Reverify Address</button>}
                  {!isDNR && <button disabled={loadingParcels} onClick={openRedispatch} className={btnGhost}>{loadingParcels ? 'Loading…' : 'Redispatch'}</button>}
                  <button onClick={() => { setRefundMode('choose'); if (t.damaged_value) setRefundAmt(String(t.damaged_value)) }} className={btnGhost}>Refund</button>
                  <button onClick={() => setResolveMode(true)} className={btnGhost}>Resolve &amp; Close</button>
                </div>

                {refundMode === 'choose' && (
                  <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 text-sm space-y-2">
                    <div className="font-medium">Raise refund request (2nd-level approval)</div>
                    <div className="flex gap-2">
                      <button onClick={() => setRefundKind('coupon')} className={`flex-1 rounded-lg border px-3 py-2 ${refundKind === 'coupon' ? 'border-[rgb(85,185,131)] bg-green-50 dark:bg-green-950' : 'border-gray-300 dark:border-gray-700'}`}>Coupon</button>
                      <button onClick={() => setRefundKind('cash')} className={`flex-1 rounded-lg border px-3 py-2 ${refundKind === 'cash' ? 'border-[rgb(85,185,131)] bg-green-50 dark:bg-green-950' : 'border-gray-300 dark:border-gray-700'}`}>Cash / amount</button>
                    </div>
                    <input type="number" min="0" step="0.01" inputMode="decimal" value={refundAmt} onChange={(e) => setRefundAmt(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="Amount (₹)" className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5" />
                    <div className="flex gap-2">
                      <button disabled={busy} onClick={async () => { if (await call('action', { action_type: 'refund_requested', action_by: 'human', notes: `${refundKind === 'coupon' ? 'Coupon' : 'Cash'} refund ₹${refundAmt || '—'} — pending 2nd-level approval` }, 'Refund request logged — pending approval.')) setRefundMode('requested') }} className="rounded bg-[rgb(85,185,131)] text-white px-3 py-1.5 text-xs font-medium disabled:opacity-50">Submit request</button>
                      <button onClick={() => setRefundMode(null)} className="text-xs text-gray-500">Cancel</button>
                    </div>
                    <div className="text-xs text-gray-400">Does not refund directly — flags for second-level verification.</div>
                  </div>
                )}

                {resolveMode && (
                  <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 text-sm space-y-2">
                    <div className="font-medium">Resolve &amp; close — no redispatch or refund</div>
                    <ResolvePicker busy={busy} onPick={async (method, note) => {
                      if (await call('close', { resolution_method: method, resolved_by: 'human', resolution_notes: note }, 'Ticket closed.')) setResolveMode(false)
                    }} onCancel={() => setResolveMode(false)} />
                  </div>
                )}
              </div>
            )}
          </Section>
        </div>

        <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-800 flex justify-end">
          <button onClick={onClose} className="rounded-lg border border-gray-300 dark:border-gray-700 px-4 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800">Close</button>
        </div>
      </div>

      {redispatchParcels && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 p-4 overflow-y-auto" onClick={() => setRedispatchParcels(null)}>
          <div className="w-full max-w-lg my-6 rounded-xl bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 font-semibold">Which parcel to redispatch?</div>
            <div className="p-4 space-y-2">
              {redispatchParcels.map((p) => (
                <button key={p.id} onClick={() => { setRedispatchParcel(p); setRedispatchParcels(null) }} className="w-full text-left rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800">
                  <div className="text-sm font-medium">{p.product_name || p.sku || p.delivery_reference}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 font-mono">{p.delivery_reference} · {p.assigned_courier ?? 'IndiaPost'} · {p.tracking_identifier || 'no tracking'} · {p.delivery_status || '—'}</div>
                </button>
              ))}
            </div>
            <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-800 flex justify-end">
              <button onClick={() => setRedispatchParcels(null)} className="text-sm text-gray-500">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {redispatchParcel && (
        <RedispatchModal
          ticketId={t.id}
          parcel={redispatchParcel}
          onClose={() => setRedispatchParcel(null)}
          onDone={(m) => { setRedispatchParcel(null); setOk(m); router.refresh() }}
        />
      )}
    </div>
  )
}

// timeline-driven next-step hint
function nextHint(t: TicketWithExtras, stage: string): string {
  if (t.complaint_type === 'delivery_delayed') {
    if (stage === 'verify_address') return t.updated_address ? 'customer changed address — verify it' : 'confirm address looks right'
    if (stage === 'contact_customer') return 'call before reverifying — tell them you’ll resend the form'
  }
  if (stage === 'file_claim') return 'files the courier claim via n8n'
  return ''
}

// ── live delivery records block (from public.delivery, courier-aware) ──
function DeliveryRecords({ deliveries, loading, sub, card }: { deliveries: ParcelForRedispatch[] | null; loading: boolean; sub: string; card: string }) {
  if (loading) return <div className={`mt-3 text-xs ${sub}`}>Loading delivery records…</div>
  if (!deliveries || deliveries.length === 0) return <div className={`mt-3 text-xs ${sub}`}>No shipping records found for this order.</div>
  return (
    <div className="mt-3 space-y-2">
      <div className={`text-[11px] uppercase tracking-wide ${sub}`}>All parcels for this order ({deliveries.length})</div>
      {deliveries.map((d) => {
        const tracking = d.tracking_identifier
        const isReship = (d.delivery_reference || '').includes('R')
        return (
          <div key={d.id} className={`${card} p-3 text-sm`}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{d.product_name || d.sku} {d.sku && <span className="text-gray-400">· {d.sku}</span>}</span>
              <div className="flex items-center gap-1.5">
                {isReship && <Pill className="bg-[rgb(85,185,131)]/15 text-[rgb(85,185,131)] border-[rgb(85,185,131)]/30">redispatch</Pill>}
                <Pill className="bg-gray-100 text-gray-600 border-gray-300 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700">{(d.delivery_status || d.complaint_status || '—').replace(/_/g, ' ')}</Pill>
              </div>
            </div>
            <p className={`text-xs ${sub} mt-1 font-mono`}>{d.delivery_reference} · {d.assigned_courier ?? 'IndiaPost'} · {tracking || 'no tracking'}</p>
            {d.complaint_status_message && <p className={`text-xs ${sub} mt-1`}>{d.complaint_status_message}</p>}
          </div>
        )
      })}
    </div>
  )
}

function StageCapture({ meta, busy, onDone, onCancel }: { meta: { label: string; capture: string }; stageKey: string; busy: boolean; onDone: (note: string, extra?: Record<string, unknown>) => void; onCancel: () => void }) {
  const [note, setNote] = useState('')
  const [qty, setQty] = useState('')
  const [val, setVal] = useState('')
  const [dispatched, setDispatched] = useState<string | null>(null)
  const inp = 'rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5'
  const greenBtn = 'rounded bg-[rgb(85,185,131)] text-white px-3 py-1.5 text-xs font-medium disabled:opacity-50'

  if (meta.capture === 'qtyval') {
    return (
      <div className="space-y-2 text-sm">
        <div className="text-xs text-gray-600 dark:text-gray-400">Review the video, then record how many units are damaged and their value (feeds the refund / coupon amount).</div>
        <div className="flex gap-2">
          <input type="number" min="0" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^0-9]/g, ''))} placeholder="Units damaged" className={`w-32 ${inp}`} />
          <input type="number" min="0" step="0.01" inputMode="decimal" value={val} onChange={(e) => setVal(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="Value (₹)" className={`w-32 ${inp}`} />
        </div>
        <div className="flex gap-2">
          <button disabled={busy} onClick={() => onDone(`${qty || '?'} unit(s) damaged · ₹${val || '?'}`, { damaged_qty: qty ? Number(qty) : null, damaged_value: val ? Number(val) : null })} className={greenBtn}>Save</button>
          <button onClick={onCancel} className="text-xs text-gray-500">Cancel</button>
        </div>
      </div>
    )
  }
  if (meta.capture === 'dispatched') {
    return (
      <div className="space-y-2 text-sm">
        <div className="text-xs text-gray-600 dark:text-gray-400">Confirm with the factory: was this item actually dispatched?</div>
        <div className="flex gap-2">
          <button onClick={() => setDispatched('yes')} className={`rounded-lg border px-3 py-1.5 ${dispatched === 'yes' ? 'border-[rgb(85,185,131)] bg-green-50 dark:bg-green-950' : 'border-gray-300 dark:border-gray-700'}`}>Yes — dispatched (courier lost it)</button>
          <button onClick={() => setDispatched('no')} className={`rounded-lg border px-3 py-1.5 ${dispatched === 'no' ? 'border-[rgb(85,185,131)] bg-green-50 dark:bg-green-950' : 'border-gray-300 dark:border-gray-700'}`}>No — not packed (our error)</button>
        </div>
        <div className="flex gap-2">
          <button disabled={busy || !dispatched} onClick={() => onDone(dispatched === 'yes' ? 'Factory confirms dispatched — courier lost it' : 'Factory: item not packed — short-pack at source', { outcome: dispatched })} className={`rounded px-3 py-1.5 text-xs font-medium ${dispatched ? 'bg-[rgb(85,185,131)] text-white' : 'bg-gray-200 text-gray-400 dark:bg-gray-800'}`}>Save</button>
          <button onClick={onCancel} className="text-xs text-gray-500">Cancel</button>
        </div>
      </div>
    )
  }
  const placeholder: Record<string, string> = {
    review: 'What does the photo/video show?', confirm: 'Confirmed correct, or note the correction',
    pod: 'Does the POD hold up? (scan/photo vs customer claim)', contact: 'What did the customer say?', claim: 'Claim reference / note',
  }
  return (
    <div className="space-y-2 text-sm">
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={placeholder[meta.capture] || 'Note'} className={`w-full ${inp}`} />
      <div className="flex gap-2">
        <button disabled={busy} onClick={() => onDone(note || meta.label)} className={greenBtn}>Mark done</button>
        <button onClick={onCancel} className="text-xs text-gray-500">Cancel</button>
      </div>
    </div>
  )
}

function ResolvePicker({ busy, onPick, onCancel }: { busy: boolean; onPick: (method: string, note: string) => void; onCancel: () => void }) {
  const [method, setMethod] = useState('self_resolved')
  const [note, setNote] = useState('')
  const opts = [['self_resolved', 'Self-resolved', 'Arrived / sorted itself'], ['no_resolution', 'No resolution', 'Closed without resolving'], ['duplicate', 'Duplicate', 'Folded into another ticket']]
  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-1">
        {opts.map(([val, label, desc]) => (
          <button key={val} onClick={() => setMethod(val)} className={`text-left rounded-lg border px-3 py-2 ${method === val ? 'border-[rgb(85,185,131)] bg-green-50 dark:bg-green-950' : 'border-gray-300 dark:border-gray-700'}`}>
            <div className="text-sm font-medium">{label}</div><div className="text-xs text-gray-500 dark:text-gray-400">{desc}</div>
          </button>
        ))}
      </div>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5 text-sm" />
      <div className="flex gap-2">
        <button disabled={busy} onClick={() => onPick(method, note)} className="rounded bg-[rgb(85,185,131)] text-white px-3 py-1.5 text-xs font-medium disabled:opacity-50">Close ticket</button>
        <button onClick={onCancel} className="text-xs text-gray-500">Cancel</button>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-xl border border-gray-200 dark:border-gray-800 p-4"><h3 className="text-sm font-semibold mb-3">{title}</h3>{children}</section>
}
function Field({ label, value, sub, danger }: { label: string; value?: string | null; sub?: string; danger?: boolean }) {
  return (
    <div className="rounded-lg bg-gray-50 dark:bg-gray-800/50 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</div>
      <div className={`text-sm font-medium ${danger ? 'text-red-600 dark:text-red-400' : ''}`}>{value || '—'}</div>
      {sub && <div className="text-xs text-gray-500 dark:text-gray-400">{sub}</div>}
    </div>
  )
}
