import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { TicketCategory } from '../../lib/types';
import { ImageField } from '../ImageField';
import { useToast } from '../Toast';
import { categoriesFor, categoryLabel, useCanUpload, useOpenTicket, type SupportScope } from './api';

const errorText = (e: unknown) =>
  e instanceof Error ? e.message : 'Something went wrong. Please try again.';

/** Form to open a support ticket; goes to the new ticket's thread once sent. */
export function NewTicket({ scope }: { scope: SupportScope }) {
  const toast = useToast();
  const navigate = useNavigate();
  const canUpload = useCanUpload();
  const send = useOpenTicket(scope);
  const categories = categoriesFor(scope);
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState<TicketCategory | ''>('');
  const [body, setBody] = useState('');
  const [imageKey, setImageKey] = useState<string | null>(null);
  const [error, setError] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const s = subject.trim();
    const b = body.trim();
    const problem =
      (s.length < 3 || s.length > 120 ? 'Subject should be 3 to 120 characters.' : null) ??
      (!category ? 'Choose what your question is about.' : null) ??
      (!b ? 'Write your message.' : null) ??
      (b.length > 4000 ? 'Message is too long (4000 characters max).' : null);
    setError(problem ?? '');
    if (problem || !category) return;
    send.mutate(
      { subject: s, category, body: b, imageKey },
      {
        onSuccess: (id) => {
          toast('Ticket sent to IWILLFLY support');
          navigate(`${scope.basePath}/${id}`, { replace: true });
        },
        onError: (err) => setError(errorText(err)),
      },
    );
  };

  return (
    <>
      <div className="section-head">
        <h2>New ticket</h2>
        <Link to={scope.basePath}>All tickets</Link>
      </div>
      <form className="form-card" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="t-subject">Subject *</label>
          <input
            id="t-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={120}
            placeholder="In a few words, what do you need help with?"
          />
        </div>
        <div className="field">
          <label htmlFor="t-category">Topic *</label>
          <select
            id="t-category"
            value={category}
            onChange={(e) => setCategory(e.target.value as TicketCategory)}
          >
            <option value="">Choose a topic</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {categoryLabel[c]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="t-body">Message *</label>
          <textarea
            id="t-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={4000}
            style={{ minHeight: 140 }}
            placeholder="Tell us what happened and what you expected. Include an invoice number or offer name if it helps."
          />
        </div>
        {canUpload && (
          <ImageField
            label="Screenshot (optional)"
            value={imageKey}
            folder="support"
            onChange={setImageKey}
            aspect="16 / 9"
          />
        )}
        {error && <p className="error-text">{error}</p>}
        <button className="btn block" type="submit" disabled={send.isPending} style={{ marginTop: 8 }}>
          {send.isPending ? 'Sending…' : 'Send to support'}
        </button>
      </form>
    </>
  );
}
