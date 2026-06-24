// app/api/complaints/[id]/deliveries/route.ts
// ============================================================
//  Fetches the FULL delivery picture for a ticket:
//   - all public.delivery parcels for the ticket's order_id
//     (this is the real shipping record, keyed by order_id)
//   - overlaid with complaints.deliveries (the complaint-specific
//     rows + any redispatch mirrors)
//  This is what powers the modal's "delivery records" section and
//  feeds the redispatch edit form with real address/courier data.
// ============================================================

import { createAdminClient } from '@/lib/supabase/server'
import { cdb, CTBL } from '@/lib/complaints-db'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()

  // 1. ticket → order_id
  const { data: ticket, error: tErr } = await cdb(supabase)
    .from(CTBL.tickets).select('id, order_id').eq('id', id).single()
  if (tErr || !ticket) return NextResponse.json({ ok: false, reason: 'ticket not found' }, { status: 404 })

  // 2. all public.delivery parcels for that order (the real shipping record)
  const { data: pubDeliveries, error: dErr } = await supabase
    .from('delivery')
    .select(`
      id, order_id, delivery_reference, parcel_number, sku, product_name, quantity,
      delivery_status, assigned_courier, tracking_id, tracking_number, tracking_link, barcode,
      shipping_address, shipping_city, shipping_state, shipping_postcode,
      customer_name, customer_phone, customer_email,
      date_shipped, shipped_from_warehouse_at, label_generated, label_cancelled,
      is_redispatch, redispatch_of
    `)
    .eq('order_id', ticket.order_id)
    .order('parcel_number', { ascending: true })
  if (dErr) return NextResponse.json({ ok: false, reason: dErr.message }, { status: 422 })

  // 3. complaints.deliveries for this ticket (complaint-specific + redispatch mirrors)
  const { data: cmpDeliveries } = await cdb(supabase)
    .from(CTBL.deliveries).select('*').eq('ticket_id', id)

  // index complaints rows by the public delivery id they point to
  const cmpByPublicId = new Map<string, Record<string, unknown>>()
  for (const c of (cmpDeliveries ?? []) as Array<Record<string, unknown>>) {
    if (c.delivery_id) cmpByPublicId.set(String(c.delivery_id), c)
  }

  // 4. merge: each public parcel + any complaint overlay (status_message, edd, is_redispatch)
  const merged = (pubDeliveries ?? []).map((d: Record<string, unknown>) => {
    const overlay = cmpByPublicId.get(String(d.id))
    return {
      ...d,
      // courier-aware tracking identifier: Mahavir / India Post (null) use barcode
      tracking_identifier:
        (d.assigned_courier === 'Mahavir' || d.assigned_courier == null)
          ? (d.barcode ?? null)
          : (d.tracking_id ?? d.tracking_number ?? null),
      complaint_status: overlay?.status ?? null,
      complaint_status_message: overlay?.status_message ?? null,
      complaint_edd: overlay?.edd ?? null,
      complaint_delivery_row_id: overlay?.id ?? null,
    }
  })

  return NextResponse.json({
    ok: true,
    order_id: ticket.order_id,
    deliveries: merged,
    // complaints.deliveries rows that have NO matching public parcel
    // (e.g. seed/test data or courier-id-only rows) — surfaced so the UI
    // can still show them and flag they're not in the shipping system.
    complaint_only: (cmpDeliveries ?? []).filter(
      (c: Record<string, unknown>) => !c.delivery_id || !cmpByPublicId.has(String(c.delivery_id)),
    ),
  }, { status: 200 })
}
