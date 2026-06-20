import { createAdminClient } from '@/lib/supabase/server'
import { cdb, CTBL } from '@/lib/complaints-db'
import { recordAction } from '@/lib/state-machine'
import { NextRequest, NextResponse } from 'next/server'

const WEBHOOK = 'https://hatabevtech-n8n-u64383.vm.elestio.app/webhook/ReverifyAddress'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data: t } = await cdb(supabase).from(CTBL.tickets).select('*').eq('id', id).single()
  if (!t) return NextResponse.json({ ok: false, reason: 'ticket not found' }, { status: 404 })

  try {
    await fetch(WEBHOOK, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticket_id: id, order_id: t.order_id, customer_phone: t.customer_phone,
      }),
    })
  } catch (e) {
    return NextResponse.json({ ok: false, reason: 'webhook failed: ' + (e instanceof Error ? e.message : '') }, { status: 502 })
  }

  await recordAction(supabase, id, {
    action_type: 'reverify_sms_sent', action_by: 'human', channel: 'sms',
    notes: 'Sent NDR form link for address/phone reconfirmation',
  })
  return NextResponse.json({ ok: true }, { status: 200 })
}
