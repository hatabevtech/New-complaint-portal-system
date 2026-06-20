import { createAdminClient } from '@/lib/supabase/server'
import { cdb, CTBL } from '@/lib/complaints-db'
import { recordAction } from '@/lib/state-machine'
import { NextRequest, NextResponse } from 'next/server'

const WEBHOOK = 'https://hatabevtech-n8n-u64383.vm.elestio.app/webhook/escalationcourier'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data: t } = await cdb(supabase).from(CTBL.tickets).select('*').eq('id', id).single()
  if (!t) return NextResponse.json({ ok: false, reason: 'ticket not found' }, { status: 404 })
  const { data: dels } = await cdb(supabase).from(CTBL.deliveries).select('*').eq('ticket_id', id)
  const d = (dels ?? [])[0]

  try {
    await fetch(WEBHOOK, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticket_id: id, order_id: t.order_id, complaint_type: t.complaint_type,
        customer_phone: t.customer_phone,
        delivery_reference: d?.delivery_reference, tracking_id: d?.tracking_id, courier: d?.courier,
      }),
    })
  } catch (e) {
    return NextResponse.json({ ok: false, reason: 'webhook failed: ' + (e instanceof Error ? e.message : '') }, { status: 502 })
  }

  await cdb(supabase).from(CTBL.tickets).update({
    ticket_status: 'awaiting_information', awaiting_since: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq('id', id)

  await recordAction(supabase, id, {
    action_type: 'escalated_to_courier', action_by: 'human', channel: 'email',
    notes: `Escalated to ${d?.courier ?? 'courier'} via n8n`,
  })
  return NextResponse.json({ ok: true }, { status: 200 })
}
