import { json, rolesFor, type Env } from './env';

const STAFF_ROLES = ['admin', 'super_admin', 'support', 'campaign_manager'];

type Checked = { ok: true; token: string; service: Record<string, string> } | { ok: false; res: Response };

/** Only super admins may use these endpoints, and only when the service-role key is set. */
async function superAdminOnly(request: Request, env: Env): Promise<Checked> {
  if (!env.SUPABASE_SERVICE_ROLE_KEY)
    return { ok: false, res: json({ error: 'SUPABASE_SERVICE_ROLE_KEY is not set for the Worker' }, 500) };
  const roles = await rolesFor(request, env);
  if (roles === null) return { ok: false, res: json({ error: 'Session expired, sign in again' }, 401) };
  if (roles === 'error') return { ok: false, res: json({ error: 'Could not verify account' }, 502) };
  if (!roles.includes('super_admin')) return { ok: false, res: json({ error: 'Super admins only' }, 403) };
  const token = request.headers.get('Authorization')!.replace(/^Bearer /, '');
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  return {
    ok: true,
    token,
    service: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  };
}

async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

async function errorText(res: Response, fallback: string) {
  const body = (await res.json().catch(() => null)) as {
    msg?: string;
    message?: string;
    error?: string;
  } | null;
  return body?.msg ?? body?.message ?? body?.error ?? fallback;
}

const isEmail = (s: string) => /^\S+@\S+\.\S+$/.test(s);
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * POST /api/admin/vendors  { email, password, full_name, phone, business_name, business_phone, whatsapp }
 * Creates a confirmed account with the given password, then makes it an approved vendor through
 * admin_create_vendor, called with the super admin's own token so the usual checks and audit log apply.
 * If the vendor cannot be created, the new account is removed again.
 */
export async function handleCreateVendor(request: Request, env: Env): Promise<Response> {
  const auth = await superAdminOnly(request, env);
  if (!auth.ok) return auth.res;
  const b = await readJson<Record<string, unknown>>(request);
  if (!b) return json({ error: 'Bad request' }, 400);
  const email = str(b.email, 254).toLowerCase();
  const password = typeof b.password === 'string' ? b.password : '';
  const fullName = str(b.full_name, 120);
  const phone = str(b.phone, 20);
  const business = str(b.business_name, 120);
  if (!isEmail(email)) return json({ error: 'Enter a valid email address' }, 400);
  if (password.length < 8 || password.length > 72)
    return json({ error: 'Password must be 8 to 72 characters' }, 400);
  if (business.length < 2) return json({ error: 'Business name should be 2 to 120 characters' }, 400);

  const created = await fetch(`${env.VITE_SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: auth.service,
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName, phone },
    }),
  });
  if (!created.ok) {
    const msg = await errorText(created, 'Could not create the account');
    const exists = created.status === 422 || /already/i.test(msg);
    return json(
      { error: exists ? 'An account with this email already exists. Use "Existing account" instead.' : msg },
      exists ? 409 : 502,
    );
  }
  const userId = ((await created.json()) as { id: string }).id;

  // The sign-up trigger made the profile from full_name; add the mobile too.
  if (phone) {
    await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
      method: 'PATCH',
      headers: auth.service,
      body: JSON.stringify({ phone }),
    });
  }

  const vendor = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/rpc/admin_create_vendor`, {
    method: 'POST',
    headers: {
      apikey: env.VITE_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${auth.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      p_email: email,
      p_business_name: business,
      p_phone: str(b.business_phone, 20) || phone,
      p_whatsapp: str(b.whatsapp, 20),
    }),
  });
  if (!vendor.ok) {
    const msg = await errorText(vendor, 'Could not create the vendor');
    await fetch(`${env.VITE_SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      method: 'DELETE',
      headers: auth.service,
    });
    return json({ error: msg }, 502);
  }
  return json({ vendor_id: await vendor.json(), user_id: userId });
}

/**
 * POST /api/admin/vendors/password  { vendor_id, password }
 * Sets a new password for the vendor's owner. Refused for IWILLFLY staff accounts. Recorded in the audit log.
 */
export async function handleSetVendorPassword(request: Request, env: Env): Promise<Response> {
  const auth = await superAdminOnly(request, env);
  if (!auth.ok) return auth.res;
  const b = await readJson<{ vendor_id?: unknown; password?: unknown }>(request);
  const vendorId = Number(b?.vendor_id);
  const password = typeof b?.password === 'string' ? b.password : '';
  if (!Number.isInteger(vendorId)) return json({ error: 'Bad request' }, 400);
  if (password.length < 8 || password.length > 72)
    return json({ error: 'Password must be 8 to 72 characters' }, 400);

  const base = env.VITE_SUPABASE_URL;
  const v = await fetch(`${base}/rest/v1/vendors?id=eq.${vendorId}&select=owner_id`, {
    headers: auth.service,
  });
  const owner = v.ok ? ((await v.json()) as { owner_id: string }[])[0]?.owner_id : undefined;
  if (!owner) return json({ error: 'Vendor not found' }, 404);

  const r = await fetch(`${base}/rest/v1/user_roles?user_id=eq.${owner}&select=role`, {
    headers: auth.service,
  });
  if (!r.ok) return json({ error: 'Could not check the account' }, 502);
  const ownerRoles = ((await r.json()) as { role: string }[]).map((x) => x.role);
  if (ownerRoles.some((x) => STAFF_ROLES.includes(x)))
    return json({ error: 'This owner is IWILLFLY staff. Staff passwords cannot be changed here.' }, 403);

  const upd = await fetch(`${base}/auth/v1/admin/users/${owner}`, {
    method: 'PUT',
    headers: auth.service,
    body: JSON.stringify({ password }),
  });
  if (!upd.ok) return json({ error: await errorText(upd, 'Could not change the password') }, 502);

  const me = await fetch(`${base}/auth/v1/user`, {
    headers: { apikey: env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${auth.token}` },
  });
  const actor = me.ok ? ((await me.json()) as { id: string }).id : null;
  await fetch(`${base}/rest/v1/admin_audit_log`, {
    method: 'POST',
    headers: auth.service,
    body: JSON.stringify({
      actor_id: actor,
      action: 'update',
      table_name: 'auth.users',
      row_id: owner,
      changes: { password: 'set by super admin', vendor_id: vendorId },
    }),
  });
  return json({ ok: true });
}
