import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

import { resolveSitesEntryAction } from './src/auth/entry-gate'

function applySecurityHeaders(response: NextResponse) {
  response.headers.set('Cache-Control', 'private, no-store, max-age=0')
  response.headers.set('Cloudflare-CDN-Cache-Control', 'no-store')
  response.headers.set('Content-Security-Policy', "base-uri 'self'; frame-ancestors 'none'; object-src 'none'")
  response.headers.set('Referrer-Policy', 'no-referrer')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-Relief-Forge-Gate', 'vinext-auth-v1')
  return response
}

function protectedRedirect(url: URL) {
  return applySecurityHeaders(NextResponse.redirect(url, 302))
}

export function proxy(request: NextRequest) {
  const action = resolveSitesEntryAction(
    request.nextUrl.pathname,
    request.headers.get('oai-authenticated-user-id'),
    request.headers.get('oai-authenticated-user-email'),
  )

  // Sites owns the OAuth callback. If dispatch has already completed sign-in
  // and injected both trusted identity headers but forwards the callback to the
  // app, recover to the protected root instead of exposing Vinext's 404 page.
  // Headerless or partial callbacks still pass through untouched; this proxy
  // never exchanges OAuth codes or treats an incomplete identity as signed in.
  if (action === 'recover-callback') {
    const response = protectedRedirect(new URL('/', request.url))
    response.headers.set('X-Relief-Forge-Auth-Recovery', 'callback')
    return response
  }

  if (action === 'allow' || action === 'pass-through') {
    return applySecurityHeaders(NextResponse.next())
  }

  const signInUrl = new URL('/signin-with-chatgpt', request.url)
  signInUrl.searchParams.set('return_to', '/')
  return protectedRedirect(signInUrl)
}

export const config = {
  matcher: ['/', '/callback'],
}
