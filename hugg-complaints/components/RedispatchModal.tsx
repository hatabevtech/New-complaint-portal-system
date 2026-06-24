'use client'
// components/RedispatchModal.tsx
// ============================================================
//  The redispatch flow the operator actually wants:
//   1. pick fault (courier = free reship / customer = note it)
//   2. EDIT the delivery fields (address, phone, courier) — pre-filled
//      from the real public.delivery parcel
//   3. confirm → POSTs edits to /redispatch which reships via
//      create_redispatch_delivery with the corrected values.
//
//  Courier-aware: Mahavir / India Post (null) show barcode as the
//  tracking identifier; Amazon / BlueDart show tracking_id.
// ============================================================
import React, { useState } from 'react'

const COURIERS = ['Amazon', 'BlueDart', 'Mahavir', 'India Post'] as const

export interface ParcelForRedispatch {
  id: string                       // public.delivery id
  delivery_reference?: string | null
  product_name?: string | null
  sku?: string | null
  assigned_courier?: string | null
  tracking_identifier?: string | null
  delivery_status?: string | null
  customer_name?: string | null
  customer_phone?: string | null
  customer_email?: string | null
  shipping_address?: string | null
  shipping_city?: string | null
  shipping_state?: string | null
  shipping_postcode?: string | null
  complaint_delivery_row_id?: string | null
}

export default function RedispatchModal({
  ticketId, parcel, onClose, onDone,
}: {
  ticketId: string
  parcel: ParcelForRedispatch
  onClose: () => void
  onDone: (msg: string) => void
}) {
  const [fault, setFault] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const courierInit = parcel.assigned_courier == null ? 'India Post' : parcel.assigned_courier
  const [form, setForm] = useState({
    customer_name:     parcel.customer_name     ?? '',
    customer_phone:    parcel.customer_phone    ?? '',
    customer_email:    parcel.customer_email    ?? '',
    shipping_address:  parcel.shipping_address  ?? '',
    shipping_city:     parcel.shipping_city     ?? '',
    shipping_state:    parcel.shipping_state    ?? '',
    shipping_postcode: parcel.shipping_postcode ?? '',
    assigned_courier:  courierInit,
    reason:            '',
    notes:            '',
  })
  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }))

  const addressChanged =
    form.shipping_address  !== (parcel.shipping_address  ?? '') ||
    form.shipping_city     !== (parcel.shipping_city     ?? '') ||
    form.shipping_postcode !== (parcel.shipping_postcode ?? '') ||
    form.customer_phone    !== (parcel.customer_phone    ?? '')

  async function submit() {
    if (!form.shipping_address || !form.shipping_postcode) { setErr('Address and pincode are required'); return }
    setBusy(true); setErr(null)
    try {
      const res = await fetch(`/api/complaints/${ticketId}/redispatch`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fault_attribution: fault,
          public_delivery_id: parcel.id,
          delivery_row_id: parcel.complaint_delivery_row_id ?? undefined,
          reason: form.reason || (fault === 'customer' ? 'customer fault redelivery' : 'courier fault reship'),
          notes: form.notes,
          updates: {
            customer_name: form.customer_name,
            customer_phone: form.customer_phone,
            customer_email: form.customer_email,
            shipping_address: form.shipping_address,
            shipping_city: form.shipping_city,
            shipping_state: form.shipping_state,
            shipping_postcode: form.shipping_postcode,
            assigned_courier: form.assigned_courier,
          },
        }),
      })
      const data = await res.json()
      if (!data.ok) { setErr(data.reason || 'Redispatch failed'); setBusy(false); return }
      onDone(`Reship created: ${data.new_reference} via ${data.courier}${data.address_changed ? ' (address corrected)' : ''}`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Request failed'); setBusy(false)
    }
  }

  const lbl = 'block text-[11px] uppercase tracking-wide text-gray-500 mb-1'
  const inp = 'w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200'

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 p-4 overflow-y-auto" onClick={onClose}>
      <div className="w-full max-w-2xl my-6 rounded-xl bg-white shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <span className="font-semibold">Redispatch</span>
            <span className="font-mono text-xs text-gray-400">{parcel.delivery_reference}</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none px-1">×</button>
        </div>

        {/* Step 1 — fault */}
        {!fault ? (
          <div className="p-5">
            <div className="text-sm font-medium mb-3">Whose fault is the failed delivery?</div>
            <div className="flex gap-3">
              <button onClick={() => setFault('courier')} className="flex-1 rounded-lg border border-gray-300 px-3 py-3 text-left hover:bg-gray-50">
                <div className="font-medium text-sm">Courier fault</div>
                <div className="text-xs text-gray-500">Free reship — courier lost/failed it</div>
              </button>
              <button onClick={() => setFault('customer')} className="flex-1 rounded-lg border border-gray-300 px-3 py-3 text-left hover:bg-gray-50">
                <div className="font-medium text-sm">Customer fault</div>
                <div className="text-xs text-gray-500">Wrong details — correct and reship</div>
              </button>
            </div>
          </div>
        ) : (
          /* Step 2 — editable fields */
          <div className="p-5 space-y-4">
            {/* context */}
            <div className="rounded-lg bg-gray-50 border border-gray-200 px-4 py-3 grid grid-cols-3 gap-x-4 gap-y-2 text-xs">
              <div><div className={lbl}>Product</div><div className="font-medium">{parcel.product_name || '—'}</div></div>
              <div><div className={lbl}>SKU</div><div className="font-mono">{parcel.sku || '—'}</div></div>
              <div><div className={lbl}>Original tracking</div><div className="font-mono">{parcel.tracking_identifier || '—'}</div></div>
              <div><div className={lbl}>Current courier</div><div>{parcel.assigned_courier ?? 'India Post'}</div></div>
              <div><div className={lbl}>Status</div><div>{parcel.delivery_status || '—'}</div></div>
              <div><div className={lbl}>Fault</div><div className="capitalize">{fault}</div></div>
            </div>

            <div className="text-xs text-gray-500">
              {fault === 'customer'
                ? 'Correct the delivery details below, then reship. The new parcel uses these values.'
                : 'Confirm or adjust the delivery details, then reship free of charge.'}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><label className={lbl}>Customer name</label><input className={inp} value={form.customer_name} onChange={e => set('customer_name', e.target.value)} /></div>
              <div><label className={lbl}>Phone</label><input className={inp} value={form.customer_phone} onChange={e => set('customer_phone', e.target.value)} /></div>
              <div><label className={lbl}>Email</label><input className={inp} value={form.customer_email} onChange={e => set('customer_email', e.target.value)} /></div>
              <div className="col-span-2"><label className={lbl}>Address</label><textarea rows={2} className={inp} value={form.shipping_address} onChange={e => set('shipping_address', e.target.value)} /></div>
              <div><label className={lbl}>City</label><input className={inp} value={form.shipping_city} onChange={e => set('shipping_city', e.target.value)} /></div>
              <div><label className={lbl}>State</label><input className={inp} value={form.shipping_state} onChange={e => set('shipping_state', e.target.value)} /></div>
              <div><label className={lbl}>Pincode</label><input className={inp} inputMode="numeric" value={form.shipping_postcode} onChange={e => set('shipping_postcode', e.target.value.replace(/[^0-9]/g, ''))} /></div>
              <div>
                <label className={lbl}>Courier</label>
                <select className={inp} value={form.assigned_courier} onChange={e => set('assigned_courier', e.target.value)}>
                  {COURIERS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="col-span-2"><label className={lbl}>Reason (optional)</label><input className={inp} value={form.reason} onChange={e => set('reason', e.target.value)} placeholder="e.g. customer gave updated address" /></div>
            </div>

            {addressChanged && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                ⚠ Delivery details changed — the new parcel will ship to the corrected address/phone.
              </div>
            )}
            {err && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{err}</div>}

            <div className="flex items-center justify-between pt-1">
              <button onClick={() => setFault(null)} className="text-xs text-gray-500">← Back</button>
              <div className="flex gap-2">
                <button onClick={onClose} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50">Cancel</button>
                <button disabled={busy} onClick={submit} className="rounded-lg bg-emerald-600 text-white px-4 py-1.5 text-sm font-medium hover:bg-emerald-700 disabled:opacity-50">
                  {busy ? 'Reshipping…' : 'Create reship'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
