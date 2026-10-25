import { json, type Env } from './env';

// Username logins for shop branches. The owner (or a branch manager, for their branch's staff) picks a
// username and password; the account gets an internal address <username>@branch.iwillfly.in that never
// receives mail. Permission checks run in the database with the caller's own token; the service-role key
// is used only for the account itself (create, password, block sign-in).
export const BRANCH_LOGIN_DOMAIN = 'branch.iwillfly.in';

type Caller =
  { ok: true; token: string; base: string; service: Record<string, string> } | { ok: false; res: Response };

function caller(request: Request, env: Env): Caller {
  if (!env.SUPABASE_SERVICE_ROLE_KEY)
    return { ok: false, res: json({ error: 'SUPABASE_SERVICE_ROLE_KEY is not set for the Worker' }, 500) };
  const token = request.headers.get('Authorization')?.replace(/^Bearer /, '');
  if (!token) return { ok: false, res: json({ error: 'Session expired, sign in again' }, 401) };
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  return {
    ok: true,
    token,
    base: env.VITE_SUPABASE_URL,
    service: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  };
}

/** Calls a database function as the signed-in caller. */
async function rpcAsCaller(c: { token: string; base: string }, env: Env, fn: string, args: unknown) {
  return fetch(`${c.base}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: env.VITE_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${c.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
}

async function errorText(res: Response, fallback: string) {
  const body = (await res.json().catch(() => null)) as {
    msg?: string;
    message?: string;
    error?: string;
  } | null;
  return body?.message ?? body?.msg ?? body?.error ?? fallback;
}

async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

const isRole = (r: unknown): r is 'manager' | 'staff' => r === 'manager' || r === 'staff';
const isUuid = (s: unknown): s is string =>
  typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const passwordProblem = (p: string) =>
  p.length < 8 || p.length > 72 ? 'Password must be 8 to 72 characters' : null;

/**
 * POST /api/vendor/branch-login  { branch_id, username, password, full_name?, role }
 * Checks the caller may add this login and the username is free, creates the account, then adds it to the
 * team. If adding fails, the new account is removed again.
 */
export async function handleCreateBranchLogin(request: Request, env: Env): Promise<Response> {
  const c = caller(request, env);
  if (!c.ok) return c.res;
  const b = await readJson<Record<string, unknown>>(request);
  const branchId = Number(b?.branch_id);
  const username = typeof b?.username === 'string' ? b.username.trim().toLowerCase() : '';
  const password = typeof b?.password === 'string' ? b.password : '';
  const fullName = typeof b?.full_name === 'string' ? b.full_name.trim().slice(0, 120) : '';
  const role = b?.role;
  if (!Number.isInteger(branchId) || !isRole(role)) return json({ error: 'Bad request' }, 400);
  const bad = passwordProblem(password);
  if (bad) return json({ error: bad }, 400);

  const check = await rpcAsCaller(c, env, 'check_branch_login', {
    p_branch_id: branchId,
    p_username: username,
    p_role: role,
  });
  if (check.status === 401) return json({ error: 'Session expired, sign in again' }, 401);
  if (!check.ok) return json({ error: await errorText(check, 'Could not check the username') }, 400);
  const vendorId = Number(await check.json());

  const created = await fetch(`${c.base}/auth/v1/admin/users`, {
    method: 'POST',
    headers: c.service,
    body: JSON.stringify({
      email: `${username}@${BRANCH_LOGIN_DOMAIN}`,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName || username },
      app_metadata: { branch_login: { vendor_id: String(vendorId), branch_id: String(branchId) } },
    }),
  });
  if (!created.ok) {
    const msg = await errorText(created, 'Could not create the login');
    const taken = created.status === 422 || /already/i.test(msg);
    return json({ error: taken ? 'That username is taken. Try another.' : msg }, taken ? 409 : 502);
  }
  const userId = ((await created.json()) as { id: string }).id;

  const attach = await rpcAsCaller(c, env, 'attach_branch_login', {
    p_user_id: userId,
    p_branch_id: branchId,
    p_role: role,
  });
  if (!attach.ok) {
    const msg = await errorText(attach, 'Could not add the login to your team');
    await fetch(`${c.base}/auth/v1/admin/users/${userId}`, { method: 'DELETE', headers: c.service });
    return json({ error: msg }, 502);
  }
  return json({ user_id: userId, username });
}

/** The caller may manage this username login (owner, or branch manager for their branch's staff). */
async function mayManage(c: { token: string; base: string }, env: Env, userId: string) {
  const res = await rpcAsCaller(c, env, 'can_manage_branch_login', { p_user_id: userId });
  if (res.status === 401) return json({ error: 'Session expired, sign in again' }, 401);
  if (!res.ok) return json({ error: 'Could not check the login' }, 502);
  if ((await res.json()) !== true)
    return json({ error: 'You can only change your own team’s branch logins' }, 403);
  return null;
}

/** POST /api/vendor/branch-login/password  { user_id, password } */
export async function handleBranchLoginPassword(request: Request, env: Env): Promise<Response> {
  const c = caller(request, env);
  if (!c.ok) return c.res;
  const b = await readJson<{ user_id?: unknown; password?: unknown }>(request);
  const password = typeof b?.password === 'string' ? b.password : '';
  if (!isUuid(b?.user_id)) return json({ error: 'Bad request' }, 400);
  const bad = passwordProblem(password);
  if (bad) return json({ error: bad }, 400);
  const refused = await mayManage(c, env, b.user_id);
  if (refused) return refused;
  const upd = await fetch(`${c.base}/auth/v1/admin/users/${b.user_id}`, {
    method: 'PUT',
    headers: c.service,
    body: JSON.stringify({ password }),
  });
  if (!upd.ok) return json({ error: await errorText(upd, 'Could not change the password') }, 502);
  return json({ ok: true });
}

/** POST /api/vendor/branch-login/active  { user_id, active } — switches sign-in off (blocked) or on again. */
export async function handleBranchLoginActive(request: Request, env: Env): Promise<Response> {
  const c = caller(request, env);
  if (!c.ok) return c.res;
  const b = await readJson<{ user_id?: unknown; active?: unknown }>(request);
  if (!isUuid(b?.user_id) || typeof b?.active !== 'boolean') return json({ error: 'Bad request' }, 400);
  const refused = await mayManage(c, env, b.user_id);
  if (refused) return refused;
  const upd = await fetch(`${c.base}/auth/v1/admin/users/${b.user_id}`, {
    method: 'PUT',
    headers: c.service,
    // about 100 years, or unblocked
    body: JSON.stringify({ ban_duration: b.active ? 'none' : '876000h' }),
  });
  if (!upd.ok) return json({ error: await errorText(upd, 'Could not change the login') }, 502);
  const set = await rpcAsCaller(c, env, 'set_branch_login_active', {
    p_user_id: b.user_id,
    p_active: b.active,
  });
  if (!set.ok) return json({ error: await errorText(set, 'Could not change the login') }, 502);
  return json({ ok: true });
}
