'use client'
import React, { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import type { TicketWithExtras } from '@/lib/data'

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

const statusBadge = (s: string) => ({
  open: 'bg-gray-100 text-gray-700 border-gray-300',
  in_progress: 'bg-blue-100 text-blue-700 border-blue-300',
  awaiting_information: 'bg-amber-100 text-amber-700 border-amber-300',
  closed: 'bg-green-100 text-green-700 border-green-300',
}[s] || 'bg-gray-100 text-gray-700 border-gray-300')
const statusText = (s: string) => ({ open: 'Open', in_progress: 'In Progress', awaiting_information: 'Awaiting Info', closed: 'Closed' }[s] || s)
const typeBadge = (t: string) => ({
  delivery_delayed: 'bg-indigo-100 text-indigo-700 border-indigo-300',
  delivered_not_received: 'bg-orange-100 text-orange-700 border-orange-300',
  damaged_item: 'bg-red-100 text-red-700 border-red-300',
  wrong_item: 'bg-red-100 text-red-700 border-red-300',
  missing_item: 'bg-purple-100 text-purple-700 border-purple-300',
}[t] || 'bg-gray-100 text-gray-700 border-gray-300')
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

export default function Console({ initialTickets }: { initialTickets: TicketWithExtras[] }) {
  const [filter, setFilter] = useState('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const tickets = initialTickets

  const counts = useMemo(() => {
    const c = { total: tickets.length, open: 0, in_progress: 0, awaiting_information: 0, closed: 0, mine: 0 } as Record<string, number>
    tickets.forEach((t) => { c[t.ticket_status]++; if (t.currently_handled_by === 'human' && t.ticket_status !== 'closed') c.mine++ })
    return c
  }, [tickets])

  const filtered = useMemo(() => {
    let rows = tickets
    if (filter === 'mine') rows = rows.filter((t) => t.currently_handled_by === 'human' && t.ticket_status !== 'closed')
    else if (filter !== 'all') rows = rows.filter((t) => t.ticket_status === filter)
    if (query.trim()) {
      const q = query.toLowerCase()
      rows = rows.filter((t) => t.ticket_number.toLowerCase().includes(q) || String(t.order_id).includes(q) || (t.order?.customer_name || '').toLowerCase().includes(q))
    }
    return rows
  }, [tickets, filter, query])

  const selected = tickets.find((t) => t.id === selectedId) || null

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <div className="border-b border-gray-200 bg-white px-6 py-3 flex items-center gap-3">
        <span className="font-semibold text-gray-900">Hugg Support</span>
        <Pill className="bg-gray-900 text-white border-gray-900">Complaints {tickets.length}</Pill>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-5">
        <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 mb-5">
          {([['Total', 'all', 'total'], ['Open', 'open', 'open'], ['In Progress', 'in_progress', 'in_progress'], ['Awaiting Info', 'awaiting_information', 'awaiting_information'], ['Closed', 'closed', 'closed'], ['Mine (to action)', 'mine', 'mine']] as const).map(([label, key, ckey]) => (
            <button key={key} onClick={() => setFilter(key)} className={`text-left rounded-xl border bg-white px-3 py-2.5 hover:shadow-sm transition border-gray-200 ${filter === key ? 'ring-2 ring-offset-1 ring-gray-400' : ''}`}>
              <div className="text-xs text-gray-500">{label}</div>
              <div className="text-xl font-semibold text-gray-900">{counts[ckey]}</div>
            </button>
          ))}
        </div>

        <div className="mb-3">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search ticket #, order ID, customer…"
            className="w-full sm:w-96 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
          <span className="ml-3 text-xs text-gray-500">{filtered.length} of {tickets.length} tickets</span>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <div className="grid grid-cols-12 gap-2 px-4 py-2 text-[11px] uppercase tracking-wide text-gray-500 border-b border-gray-100 bg-gray-50">
            <div className="col-span-3">Ticket</div><div className="col-span-4">Details</div>
            <div className="col-span-2">Handled by</div><div className="col-span-1">Age</div><div className="col-span-2 text-right">Status</div>
          </div>
          {filtered.map((t) => {
            const d0 = t.deliveries?.[0]
            return (
              <button key={t.id} onClick={() => setSelectedId(t.id)} className="w-full grid grid-cols-12 gap-2 px-4 py-3 text-left items-center border-b border-gray-50 hover:bg-gray-50 transition-colors">
                <div className="col-span-3">
                  <div className="font-medium text-gray-900 text-sm">{t.ticket_number}</div>
                  <div className="text-xs text-gray-500">#{t.order_id} · {t.order?.customer_name || '—'}</div>
                </div>
                <div className="col-span-4 flex items-center gap-2 flex-wrap">
                  <Pill className={typeBadge(t.complaint_type)}>{TYPE_LABEL[t.complaint_type]}</Pill>
                  <span className="text-xs text-gray-600">{d0?.product_name}</span>
                </div>
                <div className="col-span-2"><span className={`text-xs font-medium ${t.currently_handled_by === 'human' ? 'text-gray-900' : 'text-gray-500'}`}>{t.currently_handled_by}</span></div>
                <div className="col-span-1 text-xs text-gray-500">{ageLabel(t.created_at)}</div>
                <div className="col-span-2 flex justify-end"><Pill className={statusBadge(t.ticket_status)}>{statusText(t.ticket_status)}</Pill></div>
              </button>
            )
          })}
          {filtered.length === 0 && <div className="px-4 py-8 text-center text-sm text-gray-500">No tickets match. Try a different filter.</div>}
        </div>
      </div>

      {selected && <TicketPanel t={selected} onClose={() => setSelectedId(null)} />}
    </div>
  )
}

function TicketPanel({ t, onClose }: { t: TicketWithExtras; onClose: () => void }) {
  const router = useRouter()
  const deliveries = t.deliveries || []
  const actions = t.actions || []
  const isEvidence = EVIDENCE_TYPES.has(t.complaint_type)
  const isDNR = t.complaint_type === 'delivered_not_received'
  const isDelay = t.complaint_type === 'delivery_delayed'
  const stages = PIPELINES[t.complaint_type] || []
  const courierClaim = deliveries[0]?.status_message || ''
  const courierName = deliveries[0]?.courier || 'courier'

  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [redispatchMode, setRedispatchMode] = useState<string | null>(null)
  const [refundMode, setRefundMode] = useState<string | null>(null)
  const [refundKind, setRefundKind] = useState('coupon')
  const [refundAmt, setRefundAmt] = useState(t.damaged_value != null ? String(t.damaged_value) : '')
  const [resolveMode, setResolveMode] = useState(false)
  const [showRespond, setShowRespond] = useState(false)
  const [respondNote, setRespondNote] = useState('')
  const [stagePanel, setStagePanel] = useState(false)

  const curStage = t.current_stage
  const stageMeta = curStage ? STAGE_ACTION[curStage] : null
  const isAwaiting = t.ticket_status === 'awaiting_information'

  async function call(path: string, body: Record<string, unknown>) {
    setBusy(true); setMsg(null)
    try {
      const res = await fetch(`/api/complaints/${t.id}/${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!data.ok) { setMsg(data.reason || 'Action failed'); setBusy(false); return false }
      router.refresh() // re-fetch server data so the panel reflects the new state
      setBusy(false); return true
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Request failed'); setBusy(false); return false
    }
  }

  const nextStage = (key: string) => { const i = stages.indexOf(key); return stages[i + 1] || key }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 overflow-y-auto" onClick={onClose}>
      <div className="w-full max-w-3xl my-4 rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="font-semibold text-lg">{t.ticket_number}</span>
            <Pill className={typeBadge(t.complaint_type)}>{TYPE_LABEL[t.complaint_type]}</Pill>
            <span className="text-xs text-gray-500">{t.raised_by?.replace('_', ' + ')} · {ageLabel(t.created_at)} old</span>
          </div>
          <div className="flex items-center gap-2">
            <Pill className={statusBadge(t.ticket_status)}>{statusText(t.ticket_status)}</Pill>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none px-1">×</button>
          </div>
        </div>

        {msg && <div className="mx-5 mt-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">{msg}</div>}

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
              <div className="mt-3 rounded-lg bg-gray-50 p-3">
                <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">Delivery address & phone</div>
                {t.updated_address ? (
                  <div className="space-y-1.5">
                    <div className="flex items-start gap-2 text-sm"><span className="text-xs text-gray-400 w-16 shrink-0 mt-0.5">Original</span><span className="text-gray-500 line-through">{t.shipping_address}, {t.shipping_city}, {t.shipping_state} {t.shipping_postcode}</span></div>
                    <div className="flex items-start gap-2 text-sm"><span className="text-xs text-amber-600 w-16 shrink-0 mt-0.5 font-medium">Updated</span><span className="text-gray-900 font-medium">{t.updated_address}</span></div>
                    <div className="text-xs text-amber-600">⚠ Customer corrected the address — check whose error before redispatch.</div>
                  </div>
                ) : (
                  <div className="text-sm text-gray-800">{t.shipping_address}, {t.shipping_city}, {t.shipping_state} — {t.shipping_postcode}</div>
                )}
                {t.customer_phone && <div className="text-sm text-gray-700 mt-1">📞 {t.customer_phone}</div>}
              </div>
            )}

            <div className="mt-3 flex items-center gap-3 text-xs">
              <span className="text-gray-500">Handled by</span>
              <Pill className={t.currently_handled_by === 'human' ? 'bg-gray-900 text-white border-gray-900' : 'bg-gray-100 text-gray-600 border-gray-300'}>{t.currently_handled_by}</Pill>
              {t.currently_handled_by === 'system' && <span className="text-gray-400">— not yet handed to a human</span>}
            </div>

            {t.currently_handled_by === 'human' && (
              <div className="mt-4">
                <div className="text-xs font-medium text-gray-500 mb-2">Pipeline</div>
                <div className="flex items-center gap-1 flex-wrap">
                  {stages.map((s, i) => {
                    const curIdx = stages.indexOf(t.current_stage || '')
                    const done = i < curIdx || t.ticket_status === 'closed'
                    const cur = s === t.current_stage && t.ticket_status !== 'closed'
                    return (
                      <React.Fragment key={s}>
                        {i > 0 && <span className="text-gray-300">›</span>}
                        <span className={`text-xs px-2 py-1 rounded-md border ${cur ? 'bg-blue-50 text-blue-700 border-blue-300 font-medium' : done ? 'bg-green-50 text-green-700 border-green-200' : 'bg-gray-50 text-gray-400 border-gray-200'}`}>
                          {done && !cur ? '✓ ' : ''}{STAGE_LABEL[s]}
                        </span>
                      </React.Fragment>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="mt-4 border-t border-gray-100 pt-3">
              <div className="text-xs font-medium text-gray-500 mb-2">What&apos;s happened so far</div>
              {actions.length === 0 ? <p className="text-xs text-gray-400">No actions logged yet.</p> : (
                <ol className="space-y-2">
                  {actions.map((a) => (
                    <li key={a.id} className="flex items-start gap-2 text-xs">
                      <span className={`mt-1 h-1.5 w-1.5 rounded-full shrink-0 ${a.action_by === 'human' ? 'bg-gray-800' : 'bg-gray-400'}`} />
                      <span className="text-gray-400 tabular-nums shrink-0 w-16">{fmtAgo(a.created_at)}</span>
                      <span className="font-medium text-gray-800">{a.action_type.replace(/_/g, ' ')}</span>
                      <span className="text-gray-400">· {a.action_by}</span>
                      {a.notes && <span className="text-gray-500">— {a.notes}</span>}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </Section>

          {/* PART 2 */}
          <Section title={isDNR ? "What's disputed" : isEvidence ? 'What the customer reported' : 'Where it is, and what that means'}>
            {isDNR ? (
              <div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg bg-gray-50 border-l-2 border-blue-300 p-3"><div className="text-xs font-medium text-gray-500 mb-1">Courier says</div><div className="text-sm font-medium">Delivered</div><div className="text-xs text-gray-500 mt-1">{courierClaim}</div></div>
                  <div className="rounded-lg bg-gray-50 border-l-2 border-amber-300 p-3"><div className="text-xs font-medium text-gray-500 mb-1">Customer says</div><div className="text-sm font-medium text-amber-700">Not received</div><div className="text-xs text-gray-500 mt-1">{t.image_url || t.video_url ? 'Evidence attached' : 'No photo/video — parcel never arrived'}</div></div>
                </div>
                <p className="text-xs text-gray-600 mt-3">Order {rupee(t.order?.order_total)} — decides whether to dispute with the courier or refund directly.</p>
              </div>
            ) : isEvidence ? (
              <div className="space-y-2 text-sm">
                <p>Customer reports a <strong>{TYPE_LABEL[t.complaint_type].toLowerCase()}</strong> issue{t.missing_items ? `: ${t.missing_items}` : ''}.</p>
                <div className="flex gap-3 text-xs">
                  {t.image_url && <a href={t.image_url} target="_blank" className="text-emerald-700 underline">View photo</a>}
                  {t.video_url && <a href={t.video_url} target="_blank" className="text-emerald-700 underline">View video</a>}
                  {!t.image_url && !t.video_url && <span className="text-gray-400">No evidence attached.</span>}
                </div>
                {t.complaint_type === 'damaged_item' && (
                  <div className="text-xs text-gray-600 mt-1">{t.damaged_qty != null ? `${t.damaged_qty} unit(s) damaged · ${rupee(t.damaged_value)}` : <span className="text-amber-600">Quantity + value not yet recorded</span>}</div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {deliveries.map((d) => (
                  <div key={d.id} className="rounded-lg border border-gray-200 p-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{d.product_name} <span className="text-gray-400">· {d.sku}</span></span>
                      <Pill className="bg-gray-100 text-gray-600 border-gray-300">{(d.status || '').replace(/_/g, ' ')}</Pill>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{d.courier} · {d.tracking_id || 'no tracking'}{d.tracking_link && <a href={d.tracking_link} target="_blank" className="text-emerald-700 underline ml-1">tracking link</a>}</p>
                    {d.status_message ? <p className="text-xs text-gray-700 mt-1">{d.status_message}</p> : <p className="text-xs text-gray-400 italic mt-1">No courier status message</p>}
                    {d.edd && <p className="text-xs text-gray-400 mt-0.5">EDD: {d.edd}</p>}
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* PART 3 */}
          <Section title="What to do now">
            {t.ticket_status === 'closed' ? (
              <div className="rounded-lg bg-green-50 border border-green-200 p-3 text-sm">
                <div className="font-medium text-green-800">Resolved · {t.resolution_method?.replace(/_/g, ' ')}</div>
                <div className="text-xs text-green-700 mt-1">By {t.resolved_by} · fault: {t.fault_attribution}{t.resolution_notes ? ` — ${t.resolution_notes}` : ''}</div>
              </div>
            ) : t.currently_handled_by === 'system' ? (
              <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 text-sm text-gray-600">
                System is monitoring this delivery. It hands off to a human if attempts exceed 2 or the order passes 7 days.
                {daysSince(t.created_at) > 7 && <span className="block mt-1 text-amber-700 font-medium">⚠ Over 7 days — due for handoff.</span>}
                <div className="mt-2"><button disabled={busy} onClick={() => call('assign', { force: true, reason: 'manual handoff' })} className="rounded bg-gray-900 text-white px-3 py-1 text-xs font-medium disabled:opacity-50">Hand off to human now</button></div>
              </div>
            ) : (
              <div className="space-y-3">
                {isAwaiting && (
                  <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
                    <div className="text-sm font-medium text-amber-800">✓ Escalated to {courierName} · awaiting response</div>
                    {!showRespond ? (
                      <button onClick={() => setShowRespond(true)} className="mt-2 text-xs font-medium text-amber-800 underline">Courier responded?</button>
                    ) : (
                      <div className="mt-2 space-y-2">
                        <input value={respondNote} onChange={(e) => setRespondNote(e.target.value)} placeholder="What did the courier say?" className="w-full rounded border border-amber-300 px-2 py-1.5 text-sm focus:outline-none" />
                        <div className="flex gap-2">
                          <button disabled={busy} onClick={async () => { if (await call('respond', { note: respondNote })) { setShowRespond(false); setRespondNote('') } }} className="rounded bg-amber-600 text-white px-3 py-1 text-xs font-medium disabled:opacity-50">Save &amp; reopen</button>
                          <button onClick={() => setShowRespond(false)} className="text-xs text-gray-500">Cancel</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* current-stage primary action */}
                {stageMeta && curStage && curStage !== 'resolution' && (
                  <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3">
                    <div className="text-xs font-medium text-blue-700 mb-2">Current step</div>
                    {stagePanel ? (
                      <StageCapture meta={stageMeta} stageKey={curStage} busy={busy}
                        onDone={async (note, extra) => {
                          const ok = await call('advance', { to: nextStage(curStage), completing: curStage, action_type: curStage, action_by: 'human', notes: note, ...extra })
                          if (ok) setStagePanel(false)
                        }} onCancel={() => setStagePanel(false)} />
                    ) : (
                      <button onClick={() => setStagePanel(true)} className="rounded-lg bg-emerald-600 text-white px-3 py-1.5 text-sm font-medium hover:bg-emerald-700">{stageMeta.label}</button>
                    )}
                  </div>
                )}

                {/* secondary / resolve actions */}
                <div className="flex flex-wrap gap-2">
                  {isDelay && !isAwaiting && <button disabled={busy} onClick={() => call('escalate', { courier: courierName })} className="rounded-lg px-3 py-1.5 text-sm font-medium border bg-white text-gray-700 border-gray-300 hover:bg-gray-50 disabled:opacity-50">Escalate to courier</button>}
                  {isDelay && <button disabled={busy} onClick={() => call('action', { action_type: 'reverify_sms_sent', action_by: 'human', channel: 'sms', notes: 'Sent reverify-address SMS' })} className="rounded-lg px-3 py-1.5 text-sm font-medium border bg-white text-gray-700 border-gray-300 hover:bg-gray-50 disabled:opacity-50">Reverify Address</button>}
                  {!isDNR && <button onClick={() => setRedispatchMode('choose')} className="rounded-lg px-3 py-1.5 text-sm font-medium border bg-white text-gray-700 border-gray-300 hover:bg-gray-50">Redispatch</button>}
                  <button onClick={() => { setRefundMode('choose'); if (t.damaged_value) setRefundAmt(String(t.damaged_value)) }} className="rounded-lg px-3 py-1.5 text-sm font-medium border bg-white text-gray-700 border-gray-300 hover:bg-gray-50">Refund</button>
                  <button onClick={() => setResolveMode(true)} className="rounded-lg px-3 py-1.5 text-sm font-medium border bg-white text-gray-700 border-gray-300 hover:bg-gray-50">Resolve &amp; Close</button>
                </div>

                {/* redispatch flow */}
                {redispatchMode === 'choose' && (
  <div className="rounded-lg border border-gray-200 p-3 text-sm">
    <div className="font-medium mb-2">Whose fault is the failed delivery?</div>
    <div className="flex gap-2">
      redispatchMode
      <button onClick={() => setRedispatchMode('customer')} className="flex-1 rounded-lg border border-gray-300 px-3 py-2 hover:bg-gray-50"><div className="font-medium">Customer fault</div><div className="text-xs text-gray-500">Charge redelivery fee</div></button>
    </div>
    <button onClick={() => setRedispatchMode(null)} className="mt-2 text-xs text-gray-500">Cancel</button>
  </div>
)}}
                {redispatchMode === 'courier' && <div className="rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-800">✓ Redispatch logged — free reship (courier fault).</div>}
                {redispatchMode === 'customer' && (
                  <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm">
                    <div className="font-medium text-blue-800">Send redelivery payment link</div>
                    <div className="text-xs text-blue-700 mt-1">Reship is created once the customer pays. (Razorpay — wired later.)</div>
                    <button disabled={busy} onClick={async () => { if (await call('action', { action_type: 'fee_charged', action_by: 'human', channel: 'sms', notes: 'Sent redelivery payment link' })) setRedispatchMode('sent') }} className="mt-2 rounded bg-blue-600 text-white px-3 py-1 text-xs font-medium disabled:opacity-50">Send payment link</button>
                  </div>
                )}
                {redispatchMode === 'sent' && <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm text-blue-800">✓ Payment link sent — awaiting payment, then reship.</div>}

                {/* refund flow */}
                {refundMode === 'choose' && (
                  <div className="rounded-lg border border-gray-200 p-3 text-sm space-y-2">
                    <div className="font-medium">Raise refund request (2nd-level approval)</div>
                    <div className="flex gap-2">
                      <button onClick={() => setRefundKind('coupon')} className={`flex-1 rounded-lg border px-3 py-2 ${refundKind === 'coupon' ? 'border-emerald-400 bg-emerald-50' : 'border-gray-300'}`}>Coupon</button>
                      <button onClick={() => setRefundKind('cash')} className={`flex-1 rounded-lg border px-3 py-2 ${refundKind === 'cash' ? 'border-emerald-400 bg-emerald-50' : 'border-gray-300'}`}>Cash / amount</button>
                    </div>
                    <input value={refundAmt} onChange={(e) => setRefundAmt(e.target.value)} placeholder="Amount (₹)" className="w-full rounded border border-gray-300 px-2 py-1.5" />
                    <div className="flex gap-2">
                      <button disabled={busy} onClick={async () => { if (await call('action', { action_type: 'refund_requested', action_by: 'human', notes: `${refundKind === 'coupon' ? 'Coupon' : 'Cash'} refund ₹${refundAmt || '—'} — pending 2nd-level approval` })) setRefundMode('requested') }} className="rounded bg-emerald-600 text-white px-3 py-1.5 text-xs font-medium disabled:opacity-50">Submit request</button>
                      <button onClick={() => setRefundMode(null)} className="text-xs text-gray-500">Cancel</button>
                    </div>
                    <div className="text-xs text-gray-400">Does not refund directly — flags for second-level verification.</div>
                  </div>
                )}
                {refundMode === 'requested' && <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-800">✓ Refund requested ({refundKind}, ₹{refundAmt || '—'}) — pending approval.</div>}

                {/* resolve & close flow */}
                {resolveMode && (
                  <div className="rounded-lg border border-gray-200 p-3 text-sm space-y-2">
                    <div className="font-medium">Resolve &amp; close — no redispatch or refund</div>
                    <ResolvePicker busy={busy} onPick={async (method, note) => {
                      if (await call('close', { resolution_method: method, resolved_by: 'human', resolution_notes: note })) setResolveMode(false)
                    }} onCancel={() => setResolveMode(false)} />
                  </div>
                )}
              </div>
            )}
          </Section>
        </div>

        <div className="px-5 py-3 border-t border-gray-100 flex justify-end">
          <button onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-1.5 text-sm hover:bg-gray-50">Close</button>
        </div>
      </div>
    </div>
  )
}

function StageCapture({ meta, busy, onDone, onCancel }: { meta: { label: string; capture: string }; stageKey: string; busy: boolean; onDone: (note: string, extra?: Record<string, unknown>) => void; onCancel: () => void }) {
  const [note, setNote] = useState('')
  const [qty, setQty] = useState('')
  const [val, setVal] = useState('')
  const [dispatched, setDispatched] = useState<string | null>(null)

  if (meta.capture === 'qtyval') {
    return (
      <div className="space-y-2 text-sm">
        <div className="text-xs text-gray-600">Review the video, then record how many units are damaged and their value (feeds the refund / coupon amount).</div>
        <div className="flex gap-2">
          <input value={qty} onChange={(e) => setQty(e.target.value)} placeholder="Units damaged" className="w-32 rounded border border-gray-300 px-2 py-1.5" />
          <input value={val} onChange={(e) => setVal(e.target.value)} placeholder="Value (₹)" className="w-32 rounded border border-gray-300 px-2 py-1.5" />
        </div>
        <div className="flex gap-2">
          <button disabled={busy} onClick={() => onDone(`${qty || '?'} unit(s) damaged · ₹${val || '?'}`, { damaged_qty: qty ? Number(qty) : null, damaged_value: val ? Number(val) : null })} className="rounded bg-emerald-600 text-white px-3 py-1.5 text-xs font-medium disabled:opacity-50">Save</button>
          <button onClick={onCancel} className="text-xs text-gray-500">Cancel</button>
        </div>
      </div>
    )
  }
  if (meta.capture === 'dispatched') {
    return (
      <div className="space-y-2 text-sm">
        <div className="text-xs text-gray-600">Confirm with the factory: was this item actually dispatched?</div>
        <div className="flex gap-2">
          <button onClick={() => setDispatched('yes')} className={`rounded-lg border px-3 py-1.5 ${dispatched === 'yes' ? 'border-emerald-400 bg-emerald-50' : 'border-gray-300'}`}>Yes — dispatched (courier lost it)</button>
          <button onClick={() => setDispatched('no')} className={`rounded-lg border px-3 py-1.5 ${dispatched === 'no' ? 'border-emerald-400 bg-emerald-50' : 'border-gray-300'}`}>No — not packed (our error)</button>
        </div>
        <div className="flex gap-2">
          <button disabled={busy || !dispatched} onClick={() => onDone(dispatched === 'yes' ? 'Factory confirms dispatched — courier lost it' : 'Factory: item not packed — short-pack at source', { outcome: dispatched })} className={`rounded px-3 py-1.5 text-xs font-medium ${dispatched ? 'bg-emerald-600 text-white' : 'bg-gray-200 text-gray-400'}`}>Save</button>
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
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={placeholder[meta.capture] || 'Note'} className="w-full rounded border border-gray-300 px-2 py-1.5" />
      <div className="flex gap-2">
        <button disabled={busy} onClick={() => onDone(note || meta.label)} className="rounded bg-emerald-600 text-white px-3 py-1.5 text-xs font-medium disabled:opacity-50">Mark done</button>
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
          <button key={val} onClick={() => setMethod(val)} className={`text-left rounded-lg border px-3 py-2 ${method === val ? 'border-emerald-400 bg-emerald-50' : 'border-gray-300'}`}>
            <div className="text-sm font-medium">{label}</div><div className="text-xs text-gray-500">{desc}</div>
          </button>
        ))}
      </div>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
      <div className="flex gap-2">
        <button disabled={busy} onClick={() => onPick(method, note)} className="rounded bg-emerald-600 text-white px-3 py-1.5 text-xs font-medium disabled:opacity-50">Close ticket</button>
        <button onClick={onCancel} className="text-xs text-gray-500">Cancel</button>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-xl border border-gray-200 p-4"><h3 className="text-sm font-semibold text-gray-800 mb-3">{title}</h3>{children}</section>
}
function Field({ label, value, sub, danger }: { label: string; value?: string | null; sub?: string; danger?: boolean }) {
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`text-sm font-medium ${danger ? 'text-red-600' : 'text-gray-900'}`}>{value || '—'}</div>
      {sub && <div className="text-xs text-gray-500">{sub}</div>}
    </div>
  )
}
