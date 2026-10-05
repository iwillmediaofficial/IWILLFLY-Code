import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { useToast } from '../components/Toast';
import { db, must } from '../lib/queries';
import { VENDOR_KEY } from './api';
import { errorMessage, phoneError } from './format';

/** Registers the signed-in user as a vendor (pending review) and opens the vendor area. */
export function ApplyForm() {
  const { refreshRoles } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [error, setError] = useState('');

  const apply = useMutation({
    mutationFn: async () =>
      must(
        await db().rpc('apply_as_vendor', {
          p_business_name: name.trim(),
          p_phone: phone.trim(),
          p_whatsapp: whatsapp.trim(),
        }),
      ),
    onSuccess: async () => {
      await refreshRoles();
      await qc.invalidateQueries({ queryKey: VENDOR_KEY });
      toast('Welcome! Set up your first shop.');
      navigate('/vendor', { replace: true });
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    const problem =
      (n.length < 2 || n.length > 120 ? 'Business name should be 2 to 120 characters.' : null) ??
      phoneError(phone) ??
      phoneError(whatsapp, 'WhatsApp');
    setError(problem ?? '');
    if (!problem) apply.mutate();
  };

  return (
    <form className="form-card" onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor="biz-name">Business name *</label>
        <input id="biz-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="biz-phone">Phone</label>
          <input
            id="biz-phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            maxLength={20}
          />
        </div>
        <div className="field">
          <label htmlFor="biz-wa">WhatsApp</label>
          <input
            id="biz-wa"
            type="tel"
            value={whatsapp}
            onChange={(e) => setWhatsapp(e.target.value)}
            maxLength={20}
          />
        </div>
      </div>
      <p className="meta">
        You can add shops and offers straight away. Customers see them after the IWILLFLY team approves your
        business.
      </p>
      {error && <p className="error-text">{error}</p>}
      <button className="btn block" type="submit" disabled={apply.isPending} style={{ marginTop: 12 }}>
        {apply.isPending ? 'Sending…' : 'Apply as a vendor'}
      </button>
    </form>
  );
}
