import { useState, type FormEvent } from 'react';
import { ImageField } from '../../components/ImageField';
import { useToast } from '../../components/Toast';
import type { Branch } from '../../lib/types';
import { BranchChoice } from '../BranchChoice';
import { useBranchScope } from '../context';
import { errorMessage, orNull } from '../format';
import { useSavePrize, type BranchPrize, type PrizeWhere } from './api';

/** Add a sponsored prize, or edit one of the vendor's own, and choose the branches that hand it over. */
export function PrizeForm({
  campaignId,
  prize,
  branches,
  forBranch = null,
  onDone,
}: {
  campaignId: number;
  prize: BranchPrize | null;
  /** Every branch of the vendor's shops */
  branches: Branch[];
  /** A new prize opened from a branch page starts for that branch only */
  forBranch?: number | null;
  onDone: () => void;
}) {
  const toast = useToast();
  const save = useSavePrize(campaignId);
  const { branchId, branchName } = useBranchScope();
  // Brand editors choose where it is collected when the business has more than one branch.
  const choose = branchId == null && branches.length > 1;
  const startFor = !prize && forBranch != null && branches.some((b) => b.id === forBranch);
  const [allBranches, setAllBranches] = useState(prize?.all_branches ?? !startFor);
  const [branchIds, setBranchIds] = useState<number[]>(
    prize?.branch_ids ?? (startFor ? [forBranch as number] : []),
  );
  const won = prize ? prize.quantity - prize.remaining : 0;
  const [name, setName] = useState(prize?.name ?? '');
  const [description, setDescription] = useState(prize?.description ?? '');
  const [imageKey, setImageKey] = useState<string | null>(prize?.image_key ?? null);
  const [quantity, setQuantity] = useState(prize ? String(prize.quantity) : '');
  const [error, setError] = useState('');

  const validate = (qty: number) => {
    const n = name.trim();
    if (n.length < 2 || n.length > 120) return 'Prize name should be 2 to 120 characters.';
    if (description.trim().length > 500) return 'Description is too long (500 characters max).';
    if (quantity.trim() === '' || !Number.isInteger(qty) || qty < 0 || qty > 100000)
      return 'Quantity: enter a whole number from 0 to 100000.';
    if (qty < won) return `Quantity cannot go below the ${won} prizes already won.`;
    if (choose && !allBranches && branchIds.length === 0)
      return 'Choose at least one branch, or pick All branches.';
    return null;
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const qty = Number(quantity);
    const problem = validate(qty);
    setError(problem ?? '');
    if (problem) return;
    // Only brand editors set branches, and only when they changed (a new prize starts for all branches).
    const before = prize
      ? { all: prize.all_branches, ids: [...prize.branch_ids].sort().join() }
      : { all: true, ids: '' };
    const changed =
      before.all !== allBranches || (!allBranches && before.ids !== [...branchIds].sort().join());
    const where: PrizeWhere = choose && changed ? { all: allBranches, branchIds } : null;
    save.mutate(
      {
        id: prize?.id ?? null,
        input: {
          name: name.trim(),
          description: orNull(description),
          image_key: imageKey,
          quantity: qty,
        },
        where,
      },
      {
        onSuccess: () => {
          toast(prize ? 'Prize saved' : 'Prize sent to IWILLFLY for review');
          onDone();
        },
        onError: (err) => setError(errorMessage(err)),
      },
    );
  };

  return (
    <form className="form-card" onSubmit={submit} noValidate style={{ marginBottom: 12 }}>
      <h3 style={{ margin: '0 0 10px', fontSize: 16 }}>{prize ? 'Edit prize' : 'Add a prize'}</h3>
      {!prize && (
        <div className="notice">
          IWILLFLY reviews new prizes and sets how often they can be won. Your prize goes live once the team
          switches it on.
        </div>
      )}
      {branchId != null && (
        <div className="notice">
          {prize ? 'This prize is' : 'Prizes you add are'} collected at your branch only: {branchName}.
        </div>
      )}
      <div className="field">
        <label htmlFor="p-name">Prize name *</label>
        <input
          id="p-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          placeholder="e.g. Free cold coffee"
        />
      </div>
      <div className="field">
        <label htmlFor="p-desc">Description</label>
        <textarea
          id="p-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={500}
          placeholder="What the winner gets and any conditions"
        />
      </div>
      <ImageField
        label="Prize photo"
        value={imageKey}
        folder="prizes"
        onChange={setImageKey}
        aspect="4 / 3"
      />
      <div className="field">
        <label htmlFor="p-qty">How many to give away *</label>
        <input
          id="p-qty"
          type="number"
          inputMode="numeric"
          min={won}
          max={100000}
          step={1}
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />
        {prize && (
          <div className="hint">
            {won} already won, {prize.remaining} left. Raising the number adds stock; you can't go below {won}
            .
          </div>
        )}
      </div>
      {choose && (
        <BranchChoice
          name={`p-where-${prize?.id ?? 'new'}`}
          label="Where can winners collect it? *"
          hint="Staff of other branches can't check this prize's codes."
          branches={branches}
          all={allBranches}
          picked={branchIds}
          onChange={(all, picked) => {
            setAllBranches(all);
            setBranchIds(picked);
          }}
        />
      )}
      {error && <p className="error-text">{error}</p>}
      <div className="btn-row">
        <button className="btn" type="submit" disabled={save.isPending} style={{ flex: 1 }}>
          {save.isPending ? 'Saving…' : prize ? 'Save prize' : 'Add prize'}
        </button>
        <button className="btn secondary" type="button" disabled={save.isPending} onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}
