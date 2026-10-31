import { useMutation, useQuery } from '@tanstack/react-query';
import { useToast } from '../components/Toast';
import { db, must, type LoginForms } from '../lib/queries';
import { ErrorNotice } from './ui';
import { friendlyError, useInvalidate } from './util';

type Field = keyof LoginForms;

const TEXT: Record<Field, { name: string; on: string; off: string }> = {
  customer_signin: {
    name: 'Sign in form',
    on: 'the login page shows the email and password Sign in form.',
    off: 'the login page hides the Sign in form and the email login code. Customers sign in with Continue with Google.',
  },
  customer_signup: {
    name: 'Create account form',
    on: 'the login page shows the Create account form.',
    off: 'the login page hides the Create account form. Continue with Google still works, and existing customers still sign in.',
  },
};

/**
 * Admin switches that show or hide the email forms on the customer login page
 * (site_settings.customer_signin and site_settings.customer_signup).
 */
export function LoginFormsSwitch() {
  const toast = useToast();
  const invalidate = useInvalidate();
  const settings = useQuery({
    queryKey: ['site_settings'],
    queryFn: async () =>
      must<LoginForms | null>(
        await db().from('site_settings').select('customer_signup, customer_signin').eq('id', 1).maybeSingle(),
      ),
  });
  const save = useMutation({
    mutationFn: async ({ field, open }: { field: Field; open: boolean }) =>
      must(
        await db()
          .from('site_settings')
          .update({ [field]: open })
          .eq('id', 1)
          .select('id')
          .single(),
      ),
    onSuccess: (_, { field, open }) => {
      invalidate(['site_settings']);
      toast(open ? `${TEXT[field].name} is back on the login page` : `${TEXT[field].name} is switched off`);
    },
    onError: (e) => toast(friendlyError(e)),
  });
  const disabled = settings.isPending || save.isPending || Boolean(settings.error);
  const bothOff = settings.data?.customer_signin === false && settings.data?.customer_signup === false;

  return (
    <section className="section">
      <div className="section-head">
        <h2>Login page forms</h2>
      </div>
      {settings.error && <ErrorNotice error={settings.error} />}
      <div className="form-card">
        {(['customer_signin', 'customer_signup'] as const).map((field) => {
          const open = settings.data?.[field] !== false;
          return (
            <label key={field} className="check-row">
              <input
                type="checkbox"
                role="switch"
                checked={open}
                disabled={disabled}
                onChange={(e) => save.mutate({ field, open: e.target.checked })}
              />
              <span>
                <b>
                  {TEXT[field].name}: {open ? 'On' : 'Off'}.
                </b>{' '}
                {open ? TEXT[field].on : TEXT[field].off}
              </span>
            </label>
          );
        })}
        {bothOff && (
          <p className="meta" style={{ margin: 0 }}>
            Both are off, so the login page only shows Continue with Google.
          </p>
        )}
        <p className="meta" style={{ margin: 0 }}>
          Customers who made their account with email and password can only get in with Google if their Google
          account uses the same email. Shop owners, branch logins and admins sign in on their own pages as
          before.
        </p>
      </div>
    </section>
  );
}
