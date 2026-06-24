import { createAdminClient } from '@/lib/supabase/server'
import { cdb, CTBL } from '@/lib/complaints-db'
import { recordAction } from '@/lib/state-machine'
import { NextRequest, NextResponse } from 'next/server'

const REDISPATCH_WEBHOOK = 'https://hatabevtech-n8n-u64383.vm.elestio.app/webhook/UI_Redispatch'

interface RedispatchDelivery {
  id: string
  delivery_reference: string
  assigned_courier: string | null
  [key: string]: unknown
}

// Fields the operator may edit before reshipping. Anything present here is
// passed into create_redispatch_delivery's p_updates so the NEW public.delivery
// row carries the corrected values.
const EDITABLE = [
  'customer_name', 'customer_phone', 'customer_email',
  'shipping_address', 'shipping_city', 'shipping_state', 'shipping_postcode',
  'assigned_courier',
] as const

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await request.json().catch(() => ({}))

  const fault = body?.fault_attribution as string | undefined          // 'courier' | 'customer'
  const reason = (body?.reason as string | undefined) ?? 'redispatch'
  const notes = (body?.notes as string | undefined) ?? ''
  // Operator can pass the public.delivery id directly (preferred), or we resolve
  // it from the complaints.deliveries row via delivery_reference.
  const publicDeliveryId = body?.public_delivery_id as string | undefined
  const deliveryRowId = body?.delivery_row_id as string | undefined    // complaints.deliveries.id
  const edits = (body?.updates ?? {}) as Record<string, unknown>

  const supabase = createAdminClient()

  // ── 1. Resolve the original public.delivery id ───────────────────────────
  let originalPublicId = publicDeliveryId
  let original: Record<string, unknown> | null = null

  // Always load the complaints.deliveries row (for sku/product/courier fallback + logging)
  {
    let q = cdb(supabase).from(CTBL.deliveries).select('*').eq('ticket_id', id)
    if (deliveryRowId) q = q.eq('id', deliveryRowId)
    const { data: delRows } = await q
    original = (delRows ?? [])[0] ?? null
  }

  if (!originalPublicId) {
    if (!original) return NextResponse.json({ ok: false, reason: 'no delivery found for this ticket' }, { status: 404 })
    const ref = original.delivery_reference as string | null
    if (!ref) return NextResponse.json({ ok: false, reason: 'delivery has no reference to reship' }, { status: 422 })

    const { data: pubDel, error: pubErr } = await supabase
      .from('delivery')
      .select('id')
      .eq('delivery_reference', ref)
      .maybeSingle()
    if (pubErr) return NextResponse.json({ ok: false, reason: pubErr.message }, { status: 422 })
    if (!pubDel) return NextResponse.json({ ok: false, reason: `original delivery ${ref} not found in shipping system` }, { status: 404 })
    originalPublicId = pubDel.id as string
  }

  // ── 2. Build p_updates from the operator's edited fields ─────────────────
  const p_updates: Record<string, unknown> = {}
  for (const k of EDITABLE) {
    if (k in edits && edits[k] !== undefined) p_updates[k] = edits[k]
  }
  // India Post is stored as the literal string 'IndiaPost' (not null) in this DB.
  p_updates.last_edited_by = 'operator'

  // ── 3. Create the real reship on public.delivery ─────────────────────────
  const { data: rpcResult, error: rpcErr } = await supabase
    .rpc('create_redispatch_delivery', { p_original_delivery_id: originalPublicId, p_updates })
    .single() as { data: RedispatchDelivery | null; error: { message: string } | null }

  if (rpcErr || !rpcResult) {
    return NextResponse.json({ ok: false, reason: rpcErr?.message || 'reship RPC failed' }, { status: 422 })
  }
  let newDel: RedispatchDelivery = rpcResult


  // Apply the courier explicitly if it was edited, then RE-FETCH so the
  // webhook payload reflects exactly what is in the DB (no stale value).
  if ('assigned_courier' in p_updates) {
    await supabase.from('delivery')
      .update({ assigned_courier: p_updates.assigned_courier as string | null, updated_at: new Date().toISOString() })
      .eq('id', newDel.id)
    const { data: fresh } = await supabase.from('delivery').select('*').eq('id', newDel.id).single()
    if (fresh) newDel = fresh as RedispatchDelivery
  }

  // ── 4. Mirror into complaints.deliveries for the operator timeline ───────
  await cdb(supabase).from(CTBL.deliveries).insert({
    ticket_id: id,
    delivery_reference: newDel.delivery_reference ?? null,
    delivery_id: newDel.id ?? null,
    sku: original?.sku ?? null,
    product_name: original?.product_name ?? null,
    courier: newDel.assigned_courier ?? original?.courier ?? null,
    status: 'pending',
    is_redispatch: true,
    redispatch_of: original?.id ?? null,
  })

  // ── 5. Fault on ticket + status + action log ─────────────────────────────
  const ticketUpdate: Record<string, unknown> = { ticket_status: 'in_progress', updated_at: new Date().toISOString() }
  if (fault) ticketUpdate.fault_attribution = fault
  await cdb(supabase).from(CTBL.tickets).update(ticketUpdate).eq('id', id)

  const courierDisplay = newDel.assigned_courier || 'IndiaPost'
  const addressChanged = ['shipping_address', 'shipping_city', 'shipping_postcode'].some(k => k in p_updates)
  await recordAction(supabase, id, {
    action_type: 'redispatch_created',
    action_by: 'human',
    channel: 'system',
    courier_ref: newDel.delivery_reference,
    notes: `Reship ${newDel.delivery_reference} via ${courierDisplay}${fault ? ` — ${fault} fault` : ''}${addressChanged ? ' — address corrected' : ''}. Reason: ${reason}`,
  })

  // ── 6. Fire the redispatch webhook (label gen / courier booking) ─────────
  fetch(REDISPATCH_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'REDISPATCH', table: 'delivery', schema: 'public',
      record: { ...newDel, reason, notes },
      old_record: null, ticket_id: id,
    }),
  }).catch(() => {})

  return NextResponse.json({
    ok: true,
    new_reference: newDel.delivery_reference,
    new_delivery_id: newDel.id,
    courier: courierDisplay,
    address_changed: addressChanged,
  }, { status: 200 })
}
