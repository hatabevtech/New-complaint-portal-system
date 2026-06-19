import { createAdminClient } from '@/lib/supabase/server'
import { assignToHuman, maybeHandOff } from '@/lib/state-machine'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const supabase = createAdminClient()
  const result = body?.force
    ? await assignToHuman(supabase, id, { reason: body?.reason, actor: body?.actor })
    : await maybeHandOff(supabase, id, { attempts: body?.attempts, orderDate: body?.orderDate })
  return NextResponse.json(result, { status: result.ok ? 200 : 422 })
}
