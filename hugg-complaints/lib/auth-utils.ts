import type { User } from '@supabase/supabase-js'

// Roles that exist across the GetHugg suite (same convention as the
// order-management app: role lives in app_metadata.role).
export type UserRole =
  | 'super_admin' | 'sales_admin' | 'nutritionist_admin'
  | 'sales' | 'nutritionist' | 'logistics'

// Only these two roles may use the complaint portal.
export const ALLOWED_ROLES: UserRole[] = ['super_admin', 'logistics']

export function getUserRole(user: User | null): UserRole | null {
  if (!user) return null
  return (user.app_metadata?.role as UserRole | undefined) ?? null
}

export function isSuperAdmin(user: User | null): boolean {
  return getUserRole(user) === 'super_admin'
}

export function isLogistics(user: User | null): boolean {
  return getUserRole(user) === 'logistics'
}

// Gate for the whole app: true only for logistics + super_admin.
export function canAccessComplaints(user: User | null): boolean {
  const role = getUserRole(user)
  return role === 'super_admin' || role === 'logistics'
}
