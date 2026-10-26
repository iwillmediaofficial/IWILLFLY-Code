import { useMutation, useQuery } from '@tanstack/react-query';
import { useToast } from '../components/Toast';
import { db, must } from '../lib/queries';
import { ErrorNotice } from './ui';
import { friendlyError, useInvalidate } from './util';

/** Admin switch that shows or hides the "Create account" form on the login page (site_settings.customer_signup). */
export function SignupSwitch() {
  const toast = useToast();
  const invalidate = useInvalidate();
  const settings = useQuery({
    queryKey: ['site_settings'],
    queryFn: async () =>
      must<{ customer_signup: boolean } | null>(
        await db().from('site_settings').select('customer_signup').eq('id', 1).maybeSingle(),
      ),
  });
  const save = useMutation({
    mutationFn: async (open: boolean) =>
      must(
        await db().from('site_settings').update({ customer_signup: open }).eq('id', 1).select('id').single(),
      ),
    onSuccess: (_, open) => {
      invalidate(['site_settings']);
      toast(open ? 'Create account form is back on the login page' : 'Create account form is switched off');
    },
    onError: (e) => toast(friendlyError(e)),
  });
  const open = settings.data?.customer_signup !== false;

  return (
    <section className="section">
      <div className="section-head">
        <h2>Create account form</h2>
      </div>
      {settings.error && <ErrorNotice error={settings.error} />}
      <div className="form-card">
        <label className="check-row">
          <input
            type="checkbox"
            role="switch"
            checked={open}
            disabled={settings.isPending || save.isPending || Boolean(settings.error)}
            onChange={(e) => save.mutate(e.target.checked)}
          />
          <span>
            <b>{open ? 'On' : 'Off'}:</b>{' '}
            {open
              ? 'the login page shows the Create account form.'
              : 'the login page hides the Create account form. Continue with Google still works, and existing customers still sign in.'}
          </span>
        </label>
        <p className="meta" style={{ margin: 0 }}>
          Shop owners can still register at Register your business, and admins can still add vendors.
        </p>
      </div>
    </section>
  );
}
