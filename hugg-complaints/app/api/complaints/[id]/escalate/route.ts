import { createAdminClient } from '@/lib/supabase/server'
import { escalateToCourier } from '@/lib/state-machine'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const supabase = createAdminClient()
  const result = await escalateToCourier(supabase, id, { courier: body?.courier, notes: body?.notes })
  return NextResponse.json(result, { status: result.ok ? 200 : 422 })
}
