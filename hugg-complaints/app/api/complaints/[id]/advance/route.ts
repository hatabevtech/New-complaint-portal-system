import { createAdminClient } from '@/lib/supabase/server'
import { advanceStage } from '@/lib/state-machine'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await request.json().catch(() => null)
  if (!body?.to || !body?.action_type) {
    return NextResponse.json({ ok: false, reason: 'to and action_type are required' }, { status: 400 })
  }
  const supabase = createAdminClient()
  const result = await advanceStage(supabase, id, body)
  return NextResponse.json(result, { status: result.ok ? 200 : 422 })
}
