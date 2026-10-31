/** True only for the single email configured in ALLOWED_RESEARCHER_EMAIL. Fails closed if unset. */
export function isAllowedResearcherEmail(email: string): boolean {
  const allowed = process.env.ALLOWED_RESEARCHER_EMAIL?.trim().toLowerCase();
  if (!allowed) return false;
  return email.trim().toLowerCase() === allowed;
}
