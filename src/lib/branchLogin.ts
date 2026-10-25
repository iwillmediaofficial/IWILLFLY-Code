/** Branch logins made by a shop owner sign in with a username; the account's address is internal. */
export const BRANCH_LOGIN_DOMAIN = 'branch.iwillfly.in';

export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,29}$/;

/** "lulu-kakkanad" -> "lulu-kakkanad@branch.iwillfly.in"; an email address stays as it is. */
export function signInEmail(input: string) {
  const v = input.trim().toLowerCase();
  return v.includes('@') ? v : `${v}@${BRANCH_LOGIN_DOMAIN}`;
}

/** A starting username from the shop and branch links, e.g. "lulu-hypermarket-kakkanad". */
export function suggestUsername(shopSlug: string, branchSlug: string) {
  return `${shopSlug}-${branchSlug}`.slice(0, 30).replace(/[-._]+$/, '');
}
