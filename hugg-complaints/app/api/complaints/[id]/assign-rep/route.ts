// app/api/complaints/[id]/assign-rep/route.ts
// Sets which rep is working a ticket. Rep names are a fixed list in the UI
// (Swara / Taslima / Tanvi mam) — stored on complaints.tickets.assigned_rep_name.
import { createAdminClient } from '@/lib/supabase/server'
import { cdb, CTBL } from '@/lib/complaints-db'
import { recordAction } from '@/lib/state-machine'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const rep = (body?.rep as string | null) ?? null   // null clears the assignment

  const supabase = createAdminClient()
  const { error } = await cdb(supabase).from(CTBL.tickets)
    .update({ assigned_rep_name: rep, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return NextResponse.json({ ok: false, reason: error.message }, { status: 422 })

  await recordAction(supabase, id, {
    action_type: 'rep_assigned', action_by: 'human', channel: 'system',
    notes: rep ? `Assigned to ${rep}` : 'Rep assignment cleared',
  })
  return NextResponse.json({ ok: true, rep }, { status: 200 })
}
