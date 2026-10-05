import { useMemo, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ImageField } from '../../components/ImageField';
import { useToast } from '../../components/Toast';
import { locationPath } from '../../lib/locationPath';
import { useLocations } from '../../lib/queries';
import type { ScratchCampaign } from '../../lib/types';
import { ErrorNotice, Loading } from '../ui';
import { toNumber, useInvalidate } from '../util';
import {
  SCRATCH_KEYS,
  campaignStatus,
  deleteCampaign,
  saveCampaign,
  scratchError,
  todayIST,
  useCampaign,
  type CampaignInput,
} from './api';
import { CampaignVendors } from './CampaignVendors';
import { Prizes } from './Prizes';
import { Stats } from './Stats';
import { StatusPill } from './StatusPill';
import { Winners } from './Winners';

type Tab = 'details' | 'prizes' | 'vendors' | 'winners' | 'stats';
const TABS: { key: Tab; label: string }[] = [
  { key: 'details', label: 'Details' },
  { key: 'prizes', label: 'Prizes' },
  { key: 'vendors', label: 'Vendors' },
  { key: 'winners', label: 'Winners' },
  { key: 'stats', label: 'Stats' },
];

export function CampaignEdit() {
  const { id } = useParams();
  const campaignId = id != null && /^\d+$/.test(id) ? Number(id) : null;
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.key === params.get('tab'))?.key ?? 'details') as Tab;
  const campaign = useCampaign(campaignId);

  if (id != null && campaignId == null) {
    return <ErrorNotice error={new Error('No such campaign.')} />;
  }

  return (
    <>
      <div className="section-head">
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {campaignId ? (campaign.data?.name ?? 'Campaign') : 'New campaign'}
          </span>
          {campaign.data && <StatusPill status={campaignStatus(campaign.data)} />}
        </h2>
        <Link to="/admin/scratch">‹ All campaigns</Link>
      </div>
      {campaignId == null && <CampaignForm />}
      {campaignId != null && campaign.isPending && <Loading />}
      {campaign.error && <ErrorNotice error={campaign.error} />}
      {campaign.data && (
        <>
          <div className="tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                className={tab === t.key ? 'active' : ''}
                onClick={() => setParams({ tab: t.key }, { replace: true })}
              >
                {t.label}
              </button>
            ))}
          </div>
          {tab === 'details' && <CampaignForm key={campaign.data.updated_at} campaign={campaign.data} />}
          {tab === 'prizes' && <Prizes campaignId={campaign.data.id} />}
          {tab === 'vendors' && <CampaignVendors campaignId={campaign.data.id} />}
          {tab === 'winners' && <Winners campaignId={campaign.data.id} />}
          {tab === 'stats' && <Stats campaignId={campaign.data.id} />}
        </>
      )}
    </>
  );
}

type Form = {
  name: string;
  description: string;
  banner_key: string | null;
  starts_on: string;
  ends_on: string;
  active_from: string;
  active_to: string;
  location_id: number | null;
  max_wins: string;
  claim_valid_days: string;
  is_active: boolean;
};

function toForm(c?: ScratchCampaign): Form {
  if (!c) {
    return {
      name: '',
      description: '',
      banner_key: null,
      starts_on: todayIST(),
      ends_on: '',
      active_from: '09:00',
      active_to: '22:00',
      location_id: null,
      max_wins: '',
      claim_valid_days: '7',
      is_active: false,
    };
  }
  return {
    name: c.name,
    description: c.description ?? '',
    banner_key: c.banner_key,
    starts_on: c.starts_on,
    ends_on: c.ends_on ?? '',
    active_from: c.active_from.slice(0, 5),
    active_to: c.active_to.slice(0, 5),
    location_id: c.location_id,
    max_wins: c.max_wins_per_customer != null ? String(c.max_wins_per_customer) : '',
    claim_valid_days: String(c.claim_valid_days),
    is_active: c.is_active,
  };
}

function CampaignForm({ campaign }: { campaign?: ScratchCampaign }) {
  const toast = useToast();
  const navigate = useNavigate();
  const invalidate = useInvalidate();
  const { data: locations = [] } = useLocations();
  const [f, setF] = useState<Form>(() => toForm(campaign));
  const [error, setError] = useState('');
  const set = (patch: Partial<Form>) => setF((cur) => ({ ...cur, ...patch }));

  // Any active location works: customers whose chosen area sits inside it can play.
  const places = useMemo(
    () =>
      locations
        .filter((l) => l.is_active || l.id === f.location_id)
        .map((l) => ({ id: l.id, label: locationPath(locations, l.id) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [locations, f.location_id],
  );

  const save = useMutation({
    mutationFn: (row: CampaignInput) => saveCampaign(campaign?.id ?? null, row),
    onSuccess: (newId) => {
      invalidate(...SCRATCH_KEYS);
      toast(campaign ? 'Campaign saved' : 'Campaign created. Now add its prizes.');
      if (!campaign) navigate(`/admin/scratch/${newId}?tab=prizes`, { replace: true });
    },
    onError: (e) => setError(scratchError(e, 'This campaign is still in use.')),
  });

  const remove = useMutation({
    mutationFn: () => deleteCampaign(campaign!.id),
    onSuccess: () => {
      invalidate(...SCRATCH_KEYS);
      toast('Campaign deleted');
      navigate('/admin/scratch', { replace: true });
    },
    onError: (e) =>
      setError(
        scratchError(
          e,
          'This campaign already has plays, so it cannot be deleted (winner history is kept). ' +
            'Switch it off instead.',
        ),
      ),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const maxWins = toNumber(f.max_wins);
    const days = toNumber(f.claim_valid_days);
    if (f.name.trim().length < 2) return setError('Enter the campaign name.');
    if (!f.starts_on) return setError('Choose a start date.');
    if (f.ends_on && f.ends_on < f.starts_on)
      return setError('The end date cannot be before the start date.');
    if (!f.active_from || !f.active_to || f.active_to <= f.active_from)
      return setError('The daily end time must be after the start time.');
    if (f.max_wins.trim() && (maxWins == null || !Number.isInteger(maxWins) || maxWins < 1))
      return setError('Max wins per customer must be a whole number of 1 or more, or empty for no limit.');
    if (days == null || !Number.isInteger(days) || days < 1 || days > 90)
      return setError('Claim valid days must be a whole number from 1 to 90.');
    save.mutate({
      name: f.name.trim(),
      description: f.description.trim() || null,
      banner_key: f.banner_key,
      starts_on: f.starts_on,
      ends_on: f.ends_on || null,
      active_from: f.active_from,
      active_to: f.active_to,
      location_id: f.location_id,
      max_wins_per_customer: maxWins,
      claim_valid_days: days,
      is_active: f.is_active,
    });
  };

  return (
    <form className="form-card" onSubmit={submit}>
      <div className="field">
        <label htmlFor="sc-name">Name</label>
        <input
          id="sc-name"
          value={f.name}
          maxLength={120}
          required
          onChange={(e) => set({ name: e.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor="sc-desc">Description</label>
        <textarea
          id="sc-desc"
          maxLength={1000}
          value={f.description}
          onChange={(e) => set({ description: e.target.value })}
        />
      </div>
      <ImageField
        label="Banner"
        folder="ads"
        aspect="2 / 1"
        value={f.banner_key}
        onChange={(k) => set({ banner_key: k })}
      />
      <div className="field-row">
        <div className="field">
          <label htmlFor="sc-start">Starts on</label>
          <input
            id="sc-start"
            type="date"
            required
            value={f.starts_on}
            onChange={(e) => set({ starts_on: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="sc-end">Ends on</label>
          <input
            id="sc-end"
            type="date"
            min={f.starts_on || undefined}
            value={f.ends_on}
            onChange={(e) => set({ ends_on: e.target.value })}
          />
          <div className="hint">Leave empty to run until switched off.</div>
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="sc-from">Opens daily at</label>
          <input
            id="sc-from"
            type="time"
            required
            value={f.active_from}
            onChange={(e) => set({ active_from: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="sc-to">Closes daily at</label>
          <input
            id="sc-to"
            type="time"
            required
            value={f.active_to}
            onChange={(e) => set({ active_to: e.target.value })}
          />
        </div>
      </div>
      <div className="hint" style={{ fontSize: 11, color: 'var(--color-muted)', margin: '-6px 0 12px' }}>
        Dates and times are India time. Each customer can scratch once a day.
      </div>
      <div className="field">
        <label htmlFor="sc-area">Who can play</label>
        <select
          id="sc-area"
          value={f.location_id ?? ''}
          onChange={(e) => set({ location_id: e.target.value ? Number(e.target.value) : null })}
        >
          <option value="">All areas (everyone)</option>
          {places.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <div className="hint">Customers whose chosen area is inside this location can play.</div>
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="sc-maxwins">Max wins per customer</label>
          <input
            id="sc-maxwins"
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            placeholder="No limit"
            value={f.max_wins}
            onChange={(e) => set({ max_wins: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="sc-days">Claim valid for (days)</label>
          <input
            id="sc-days"
            type="number"
            min={1}
            max={90}
            step={1}
            inputMode="numeric"
            required
            value={f.claim_valid_days}
            onChange={(e) => set({ claim_valid_days: e.target.value })}
          />
        </div>
      </div>
      <label className="check-row">
        <input type="checkbox" checked={f.is_active} onChange={(e) => set({ is_active: e.target.checked })} />
        Campaign on (customers can see and play it)
      </label>
      {error && <p className="error-text">{error}</p>}
      <div className="btn-row">
        <button className="btn" type="submit" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : campaign ? 'Save campaign' : 'Create campaign'}
        </button>
        {campaign && (
          <button
            className="btn danger"
            type="button"
            disabled={remove.isPending}
            style={{ marginLeft: 'auto' }}
            onClick={() => {
              if (
                window.confirm(
                  `Delete ${campaign.name}?\n\nIts prizes and vendor list are deleted too. A campaign that ` +
                    'already has plays cannot be deleted; switch it off instead.',
                )
              )
                remove.mutate();
            }}
          >
            Delete campaign
          </button>
        )}
      </div>
    </form>
  );
}
