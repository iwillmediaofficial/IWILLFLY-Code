import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useToast } from '../../components/Toast';
import type { BillingSettings } from '../../lib/types';
import { ErrorNotice, Loading } from '../ui';
import { toNumber, useInvalidate } from '../util';
import { BILL_KEYS, billError, saveSettings, useBillingSettings } from './api';

export function Settings() {
  const settings = useBillingSettings();
  return (
    <>
      <div className="section-head">
        <h2>Billing settings</h2>
      </div>
      <div className="notice">
        These details are printed on new invoices. Invoices already sent keep the details they were made with.
      </div>
      {settings.isPending && <Loading />}
      {settings.error && <ErrorNotice error={settings.error} />}
      {settings.data && <SettingsForm key={settings.data.updated_at} settings={settings.data} />}
    </>
  );
}

function SettingsForm({ settings: s }: { settings: BillingSettings }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const [f, setF] = useState({
    upi_id: s.upi_id ?? '',
    payee_name: s.payee_name ?? '',
    business_name: s.business_name ?? '',
    business_address: s.business_address ?? '',
    gstin: s.gstin ?? '',
    gst_percent: String(Number(s.gst_percent)),
    invoice_prefix: s.invoice_prefix,
    payment_note: s.payment_note ?? '',
  });
  const [error, setError] = useState('');
  const set = (patch: Partial<typeof f>) => setF((cur) => ({ ...cur, ...patch }));

  const save = useMutation({
    mutationFn: saveSettings,
    onSuccess: () => {
      invalidate(...BILL_KEYS);
      toast('Billing settings saved');
    },
    onError: (e) => setError(billError(e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const upi = f.upi_id.trim();
    const gstin = f.gstin.trim().toUpperCase();
    const gst = toNumber(f.gst_percent);
    const prefix = f.invoice_prefix.trim().toUpperCase();
    if (upi && !/^[A-Za-z0-9._-]{2,200}@[A-Za-z]{2,64}$/.test(upi))
      return setError('Enter a UPI ID like iwillfly@okicici.');
    if (gstin && !/^[0-9A-Z]{15}$/.test(gstin)) return setError('A GSTIN is 15 capital letters and numbers.');
    if (gst == null || gst < 0 || gst > 28) return setError('GST must be between 0 and 28 percent.');
    if (!/^[A-Z0-9]{1,8}$/.test(prefix))
      return setError('The invoice prefix may use 1 to 8 capital letters and numbers.');
    save.mutate({
      upi_id: upi || null,
      payee_name: f.payee_name.trim() || null,
      business_name: f.business_name.trim() || null,
      business_address: f.business_address.trim() || null,
      gstin: gstin || null,
      gst_percent: Math.round(gst * 100) / 100,
      invoice_prefix: prefix,
      payment_note: f.payment_note.trim() || null,
    });
  };

  return (
    <form className="form-card" onSubmit={submit}>
      <h3 style={{ marginTop: 0 }}>Where vendors pay</h3>
      {!s.upi_id && <div className="notice warn">Add your UPI ID so vendors can pay their invoices.</div>}
      <div className="field">
        <label htmlFor="bs-upi">UPI ID</label>
        <input
          id="bs-upi"
          value={f.upi_id}
          maxLength={265}
          autoCapitalize="none"
          placeholder="iwillfly@okicici"
          onChange={(e) => set({ upi_id: e.target.value })}
        />
        <div className="hint">Vendors see this on every unpaid invoice.</div>
      </div>
      <div className="field">
        <label htmlFor="bs-payee">Name on the UPI account</label>
        <input
          id="bs-payee"
          value={f.payee_name}
          maxLength={100}
          onChange={(e) => set({ payee_name: e.target.value })}
        />
      </div>

      <h3>Printed on invoices</h3>
      <div className="field">
        <label htmlFor="bs-name">Business name</label>
        <input
          id="bs-name"
          value={f.business_name}
          maxLength={120}
          placeholder="IWILLFLY"
          onChange={(e) => set({ business_name: e.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor="bs-address">Business address</label>
        <textarea
          id="bs-address"
          value={f.business_address}
          maxLength={400}
          style={{ minHeight: 70 }}
          onChange={(e) => set({ business_address: e.target.value })}
        />
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="bs-gstin">GSTIN</label>
          <input
            id="bs-gstin"
            value={f.gstin}
            maxLength={15}
            autoCapitalize="characters"
            placeholder="Optional"
            onChange={(e) => set({ gstin: e.target.value.toUpperCase() })}
          />
        </div>
        <div className="field">
          <label htmlFor="bs-gst">GST %</label>
          <input
            id="bs-gst"
            type="number"
            min={0}
            max={28}
            step="0.01"
            inputMode="decimal"
            value={f.gst_percent}
            onChange={(e) => set({ gst_percent: e.target.value })}
          />
        </div>
      </div>
      <div className="hint" style={{ fontSize: 11, color: 'var(--color-muted)', margin: '-6px 0 12px' }}>
        GST is added on top of plan and add-on prices. Use 0 if you are not GST registered.
      </div>
      <div className="field">
        <label htmlFor="bs-prefix">Invoice number prefix</label>
        <input
          id="bs-prefix"
          value={f.invoice_prefix}
          maxLength={8}
          autoCapitalize="characters"
          onChange={(e) => set({ invoice_prefix: e.target.value.toUpperCase() })}
        />
        <div className="hint">
          Invoices are numbered {f.invoice_prefix.trim().toUpperCase() || 'IWF'}-{new Date().getFullYear()}
          -00001 and so on.
        </div>
      </div>
      <div className="field">
        <label htmlFor="bs-note">Note on every invoice</label>
        <textarea
          id="bs-note"
          value={f.payment_note}
          maxLength={400}
          style={{ minHeight: 70 }}
          placeholder="Thank you for your business. Questions? WhatsApp 98xxxxxxxx."
          onChange={(e) => set({ payment_note: e.target.value })}
        />
      </div>
      {error && <p className="error-text">{error}</p>}
      <div className="btn-row">
        <button className="btn" type="submit" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save settings'}
        </button>
      </div>
    </form>
  );
}
