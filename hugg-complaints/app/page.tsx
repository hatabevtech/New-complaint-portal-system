// app/page.tsx — server component: auth-gate (logistics + super_admin only),
// then fetch tickets and render the console exactly as before.
import { listTickets, type TicketWithExtras } from '@/lib/data'
import Console from '@/components/Console'
import { createClient } from '@/lib/supabase/server'
import { canAccessComplaints } from '@/lib/auth-utils'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic' // always fetch fresh from DB

export default async function Page() {
  // ── Auth gate: only logistics + super_admin may enter ──────────────────
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')
  if (!canAccessComplaints(user)) redirect('/auth/login?denied=1')

  // ── Data (unchanged) ───────────────────────────────────────────────────
  let tickets: TicketWithExtras[] = []
  let error: string | null = null
  try {
    tickets = await listTickets()
  } catch (e) {
    error = e instanceof Error ? e.message : 'Failed to load tickets'
    tickets = []
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto mt-20 rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">
        <div className="font-semibold mb-1">Couldn’t load complaints</div>
        <div className="text-red-700">{error}</div>
        <div className="mt-3 text-xs text-red-600">
          Check that the Supabase env vars are set and the <code>complaints</code> schema is added to Exposed Schemas in Supabase → Settings → API.
        </div>
      </div>
    )
  }

  return <Console initialTickets={tickets} />
}
