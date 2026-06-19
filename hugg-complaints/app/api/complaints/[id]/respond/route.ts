import { createAdminClient } from '@/lib/supabase/server'
import { courierResponded } from '@/lib/state-machine'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const supabase = createAdminClient()
  const result = await courierResponded(supabase, id, { note: body?.note })
  return NextResponse.json(result, { status: result.ok ? 200 : 422 })
}
