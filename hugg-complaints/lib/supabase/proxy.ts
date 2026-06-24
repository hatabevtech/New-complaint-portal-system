import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const ALLOWED_ROLES = ['super_admin', 'logistics']

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options))
        },
      },
    },
  )

  const publicRoutes = ['/auth/login', '/auth/error', '/auth/callback']
  const isPublicRoute = publicRoutes.some(r => request.nextUrl.pathname.startsWith(r))

  // API routes handle their own auth (service-role); never redirect them.
  if (request.nextUrl.pathname.startsWith('/api/')) return supabaseResponse

  let user = null
  try {
    const { data } = await supabase.auth.getUser()
    user = data.user
  } catch { /* fall through to redirect */ }

  // Not logged in + protected route → login
  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/auth/login'
    return NextResponse.redirect(url)
  }

  // Logged in but WRONG role → bounce to a no-access page (and sign out via login).
  if (user && !isPublicRoute) {
    const role = (user.app_metadata?.role as string | undefined) ?? null
    if (!role || !ALLOWED_ROLES.includes(role)) {
      const url = request.nextUrl.clone()
      url.pathname = '/auth/login'
      url.searchParams.set('denied', '1')
      return NextResponse.redirect(url)
    }
  }

  // Logged in + on login page → home
  if (user && isPublicRoute && !request.nextUrl.pathname.startsWith('/auth/callback')) {
    const role = (user.app_metadata?.role as string | undefined) ?? null
    if (role && ALLOWED_ROLES.includes(role)) {
      const url = request.nextUrl.clone()
      url.pathname = '/'
      return NextResponse.redirect(url)
    }
  }

  return supabaseResponse
}
