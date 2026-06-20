import { createAdminClient } from '@/lib/supabase/server'
import { cdb, CTBL } from '@/lib/complaints-db'
import { recordAction } from '@/lib/state-machine'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const fault = body?.fault_attribution as string | undefined   // 'courier' | 'customer'
  const deliveryRowId = body?.delivery_row_id as string | undefined // complaints.deliveries.id to reship
  const supabase = createAdminClient()

  // 1. get the complaints.deliveries row (its delivery_reference is the join key)
  let q = cdb(supabase).from(CTBL.deliveries).select('*').eq('ticket_id', id)
  if (deliveryRowId) q = q.eq('id', deliveryRowId)
  const { data: delRows, error: delErr } = await q
  if (delErr) return NextResponse.json({ ok: false, reason: delErr.message }, { status: 422 })
  const original = (delRows ?? [])[0]
  if (!original) return NextResponse.json({ ok: false, reason: 'no delivery found for this ticket' }, { status: 404 })
  if (!original.delivery_reference) return NextResponse.json({ ok: false, reason: 'delivery has no reference to reship' }, { status: 422 })

  // 2. find the original public.delivery by delivery_reference
  const { data: pubDel, error: pubErr } = await supabase
    .from('delivery')
    .select('id')
    .eq('delivery_reference', original.delivery_reference)
    .maybeSingle()
  if (pubErr) return NextResponse.json({ ok: false, reason: pubErr.message }, { status: 422 })
  if (!pubDel) return NextResponse.json({ ok: false, reason: `original delivery ${original.delivery_reference} not found in shipping system` }, { status: 404 })

  // 3. call the existing reship function on public.delivery
  const { data: newDel, error: rpcErr } = await supabase
    .rpc('create_redispatch_delivery', { p_original_delivery_id: pubDel.id, p_updates: {} })
  if (rpcErr) return NextResponse.json({ ok: false, reason: rpcErr.message }, { status: 422 })

  const created = Array.isArray(newDel) ? newDel[0] : newDel

  // 4. insert a linked complaints.deliveries row (mirrors the reship for the operator UI)
  const { error: insErr } = await cdb(supabase).from(CTBL.deliveries).insert({
    ticket_id: id,
    delivery_reference: created?.delivery_reference ?? null,
    delivery_id: created?.id ?? null,
    sku: original.sku,
    product_name: original.product_name,
    courier: created?.assigned_courier ?? original.courier,
    status: 'pending',
    is_redispatch: true,
    redispatch_of: original.id,
  })
  if (insErr) return NextResponse.json({ ok: false, reason: insErr.message }, { status: 422 })

  // 5. write fault on ticket + log the action
  if (fault) {
    await cdb(supabase).from(CTBL.tickets).update({ fault_attribution: fault, updated_at: new Date().toISOString() }).eq('id', id)
  }
  await recordAction(supabase, id, {
    action_type: 'redispatch_created',
    action_by: 'human',
    notes: `Reship ${created?.delivery_reference ?? ''} created${fault ? ` — ${fault} fault` : ''}`,
  })

  return NextResponse.json({ ok: true, new_reference: created?.delivery_reference }, { status: 200 })
}
