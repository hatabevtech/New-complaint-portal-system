// app/page.tsx — server component: fetch tickets, render the console.
import { listTickets, type TicketWithExtras } from '@/lib/data'
import Console from '@/components/Console'

export const dynamic = 'force-dynamic' // always fetch fresh from DB

export default async function Page() {
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
