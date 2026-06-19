import { createAdminClient } from '@/lib/supabase/server'
import { recordAction } from '@/lib/state-machine'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await request.json().catch(() => null)
  if (!body?.action_type) {
    return NextResponse.json({ ok: false, reason: 'action_type is required' }, { status: 400 })
  }
  const supabase = createAdminClient()
  const result = await recordAction(supabase, id, body)
  return NextResponse.json(result, { status: result.ok ? 200 : 422 })
}
