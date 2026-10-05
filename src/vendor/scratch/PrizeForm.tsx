import { useState, type FormEvent } from 'react';
import { ImageField } from '../../components/ImageField';
import { useToast } from '../../components/Toast';
import type { ScratchPrize } from '../../lib/types';
import { errorMessage, orNull } from '../format';
import { useSavePrize } from './api';

/** Add a sponsored prize, or edit one of the vendor's own. */
export function PrizeForm({
  campaignId,
  prize,
  onDone,
}: {
  campaignId: number;
  prize: ScratchPrize | null;
  onDone: () => void;
}) {
  const toast = useToast();
  const save = useSavePrize(campaignId);
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
    return null;
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const qty = Number(quantity);
    const problem = validate(qty);
    setError(problem ?? '');
    if (problem) return;
    save.mutate(
      {
        id: prize?.id ?? null,
        input: {
          name: name.trim(),
          description: orNull(description),
          image_key: imageKey,
          quantity: qty,
        },
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
