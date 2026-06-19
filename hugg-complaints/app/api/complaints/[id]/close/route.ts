import { createAdminClient } from '@/lib/supabase/server'
import { closeTicket } from '@/lib/state-machine'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await request.json().catch(() => null)
  if (!body?.resolution_method || !body?.resolved_by) {
    return NextResponse.json({ ok: false, reason: 'resolution_method and resolved_by are required' }, { status: 400 })
  }
  const supabase = createAdminClient()
  const result = await closeTicket(supabase, id, body)
  return NextResponse.json(result, { status: result.ok ? 200 : 422 })
}
