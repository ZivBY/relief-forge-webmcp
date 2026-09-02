export type SitesEntryAction =
  | 'allow'
  | 'pass-through'
  | 'recover-callback'
  | 'sign-in'

export function resolveSitesEntryAction(
  pathname: string,
  userId: string | null,
  email: string | null,
): SitesEntryAction {
  const hasCompleteIdentity = Boolean(userId && email)

  if (pathname === '/callback') {
    return hasCompleteIdentity ? 'recover-callback' : 'pass-through'
  }
  if (pathname === '/') {
    return hasCompleteIdentity ? 'allow' : 'sign-in'
  }
  return 'pass-through'
}
