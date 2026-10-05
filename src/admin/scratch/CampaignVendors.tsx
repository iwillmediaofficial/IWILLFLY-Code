import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useToast } from '../../components/Toast';
import { ErrorNotice, Loading } from '../ui';
import { formatDate, one, useInvalidate } from '../util';
import {
  SCRATCH_KEYS,
  addCampaignVendor,
  removeCampaignVendor,
  scratchError,
  useApprovedVendors,
  useCampaignVendors,
} from './api';

export function CampaignVendors({ campaignId }: { campaignId: number }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const joined = useCampaignVendors(campaignId);
  const approved = useApprovedVendors();
  const [pick, setPick] = useState('');
  const [error, setError] = useState('');

  const joinedIds = new Set((joined.data ?? []).map((r) => r.vendor_id));
  const available = (approved.data ?? []).filter((v) => !joinedIds.has(v.id));

  const add = useMutation({
    mutationFn: (vendorId: number) => addCampaignVendor(campaignId, vendorId),
    onSuccess: () => {
      invalidate(...SCRATCH_KEYS);
      setPick('');
      setError('');
      toast('Vendor added to campaign');
    },
    onError: (e) => setError(scratchError(e, 'That vendor cannot be added.')),
  });

  const remove = useMutation({
    mutationFn: (vendorId: number) => removeCampaignVendor(campaignId, vendorId),
    onSuccess: () => {
      invalidate(...SCRATCH_KEYS);
      toast('Vendor removed from campaign');
    },
    onError: (e) => toast(scratchError(e, 'That vendor cannot be removed.')),
  });

  return (
    <section>
      <div className="section-head">
        <h2>Vendors</h2>
        <span className="meta">{joined.data?.length ?? 0} joined</span>
      </div>
      <div className="form-card">
        <div className="field">
          <label htmlFor="cv-pick">Add an approved vendor</label>
          <select id="cv-pick" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">{approved.isPending ? 'Loading vendors…' : 'Choose a vendor'}</option>
            {available.map((v) => (
              <option key={v.id} value={v.id}>
                {v.business_name}
              </option>
            ))}
          </select>
          <div className="hint">Joined vendors can sponsor prizes and see their own winners.</div>
        </div>
        {approved.error && <ErrorNotice error={approved.error} />}
        {error && <p className="error-text">{error}</p>}
        <button
          className="btn small"
          disabled={!pick || add.isPending}
          onClick={() => add.mutate(Number(pick))}
        >
          {add.isPending ? 'Adding…' : 'Add vendor'}
        </button>
      </div>

      {joined.isPending && <Loading />}
      {joined.error && <ErrorNotice error={joined.error} />}
      {joined.data?.length === 0 && <p className="meta">No vendors in this campaign yet.</p>}
      <div style={{ marginTop: 10 }}>
        {joined.data?.map((r) => {
          const v = one(r.vendor);
          const name = v?.business_name ?? 'Vendor';
          return (
            <div
              key={r.vendor_id}
              className="manage-card"
              style={{ display: 'flex', alignItems: 'center', gap: 10 }}
            >
              <div className="grow" style={{ minWidth: 0 }}>
                <h4>{name}</h4>
                <div className="meta">
                  Joined {formatDate(r.joined_at)}
                  {v && v.status !== 'approved' && (
                    <>
                      {' · '}
                      <span className={`pill-status ${v.status}`}>{v.status}</span>
                    </>
                  )}
                </div>
              </div>
              <button
                className="btn small danger"
                disabled={remove.isPending}
                onClick={() => {
                  if (
                    window.confirm(
                      `Remove ${name} from this campaign?\n\nPrizes they sponsor stay in the campaign; switch ` +
                        'them off in Prizes if they should stop.',
                    )
                  )
                    remove.mutate(r.vendor_id);
                }}
              >
                Remove
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
