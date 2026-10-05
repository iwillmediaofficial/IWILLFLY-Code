import { useState } from 'react';
import { DAYS, formatTime } from '../lib/hours';
import type { DayKey, Hours } from '../lib/types';
import { formatDate, todayIST } from './format';

const DEFAULT_DAY = { open: '09:00', close: '21:00' };

/** One row per weekday: closed, or open and close times. Close earlier than open means past midnight. */
export function HoursEditor({ value, onChange }: { value: Hours; onChange: (h: Hours) => void }) {
  const setDay = (key: DayKey, day: { open: string; close: string } | null) => {
    const next = { ...value };
    if (day) next[key] = day;
    else delete next[key];
    onChange(next);
  };
  const first = DAYS.map((d) => value[d.key]).find(Boolean);

  return (
    <div className="field">
      <label>Opening hours</label>
      {DAYS.map(({ key, label }) => {
        const day = value[key];
        return (
          <div key={key}>
            <div className="hours-row">
              <div>
                {label}
                <label
                  className="meta"
                  style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 600 }}
                >
                  <input
                    type="checkbox"
                    checked={!day}
                    onChange={(e) => setDay(key, e.target.checked ? null : (first ?? DEFAULT_DAY))}
                  />
                  Closed
                </label>
              </div>
              {day ? (
                <>
                  <input
                    type="time"
                    aria-label={`${label} opens`}
                    value={day.open}
                    onChange={(e) => setDay(key, { ...day, open: e.target.value })}
                  />
                  <input
                    type="time"
                    aria-label={`${label} closes`}
                    value={day.close}
                    onChange={(e) => setDay(key, { ...day, close: e.target.value })}
                  />
                </>
              ) : (
                <span className="closed">Closed all day</span>
              )}
            </div>
            {day && day.open && day.close && day.close < day.open && (
              <p className="meta" style={{ margin: '-4px 0 8px 100px' }}>
                Closes after midnight, at {formatTime(day.close)} the next day
              </p>
            )}
          </div>
        );
      })}
      {first && (
        <button
          type="button"
          className="link-btn"
          onClick={() => onChange(Object.fromEntries(DAYS.map((d) => [d.key, first])) as Hours)}
        >
          Use {formatTime(first.open)} – {formatTime(first.close)} every day
        </button>
      )}
    </div>
  );
}

/** Dates the branch is shut, stored as ISO "YYYY-MM-DD" strings. */
export function HolidaysEditor({ value, onChange }: { value: string[]; onChange: (d: string[]) => void }) {
  const [date, setDate] = useState('');
  const today = todayIST();
  const add = () => {
    if (!date || value.includes(date)) return setDate('');
    onChange([...value, date].sort());
    setDate('');
  };
  return (
    <div className="field">
      <label htmlFor="b-holiday">Holidays</label>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          id="b-holiday"
          type="date"
          min={today}
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <button
          type="button"
          className="btn secondary small"
          onClick={add}
          disabled={!date || value.length >= 60}
        >
          Add
        </button>
      </div>
      <div className="hint">Customers see the branch as closed on these dates.</div>
      {value.length > 0 && (
        <div className="filter-bar" style={{ flexWrap: 'wrap', margin: '8px 0 0' }}>
          {value.map((d) => (
            <span key={d} className="chip" style={{ cursor: 'default', opacity: d < today ? 0.55 : 1 }}>
              {formatDate(d)}{' '}
              <button
                type="button"
                className="link-btn"
                aria-label={`Remove ${formatDate(d)}`}
                onClick={() => onChange(value.filter((x) => x !== d))}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
