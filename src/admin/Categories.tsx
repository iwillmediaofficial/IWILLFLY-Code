import { useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useToast } from '../components/Toast';
import { db, must } from '../lib/queries';
import { mediaUrl } from '../lib/supabase';
import type { Category } from '../lib/types';
import { uploadImage } from '../lib/upload';
import { Empty, ErrorNotice, Loading } from './ui';
import { PUBLIC_KEYS, friendlyError, slugify, toNumber, useInvalidate } from './util';

const KEYS = [['admin', 'categories'], ['categories'], ...PUBLIC_KEYS];

export function Categories() {
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  const categories = useQuery({
    queryKey: ['admin', 'categories'],
    queryFn: async () =>
      must<Category[]>(await db().from('categories').select('*').order('sort_order').order('name')),
  });
  const list = categories.data ?? [];
  const nextSort = list.length ? Math.max(...list.map((c) => c.sort_order)) + 10 : 10;

  return (
    <>
      <div className="section-head">
        <h2>Categories</h2>
        {editing !== 'new' && (
          <button className="btn small" onClick={() => setEditing('new')}>
            ＋ Add category
          </button>
        )}
      </div>
      {editing === 'new' && <CategoryForm nextSort={nextSort} onDone={() => setEditing(null)} />}
      {categories.isPending && <Loading />}
      {categories.error && <ErrorNotice error={categories.error} />}
      {categories.data?.length === 0 && <Empty emoji="🗂️" title="No categories yet" />}
      <div style={{ marginTop: 10 }}>
        {list.map((c) =>
          editing !== 'new' && editing?.id === c.id ? (
            <CategoryForm key={c.id} category={c} nextSort={nextSort} onDone={() => setEditing(null)} />
          ) : (
            <div
              key={c.id}
              className="manage-card"
              style={{ display: 'flex', alignItems: 'center', gap: 12 }}
            >
              <div className="cat-thumb" aria-hidden="true">
                {c.image_key ? (
                  <img
                    src={mediaUrl(c.image_key)}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    width={48}
                    height={48}
                  />
                ) : (
                  c.icon || '🏷️'
                )}
              </div>
              <div className="grow">
                <h4>
                  {c.name} {!c.is_active && <span className="pill-status">Hidden</span>}
                </h4>
                <div className="meta">
                  /{c.slug} · order {c.sort_order}
                </div>
              </div>
              <button className="btn small secondary" onClick={() => setEditing(c)}>
                Edit
              </button>
            </div>
          ),
        )}
      </div>
    </>
  );
}

function CategoryForm({
  category,
  nextSort,
  onDone,
}: {
  category?: Category;
  nextSort: number;
  onDone: () => void;
}) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const [name, setName] = useState(category?.name ?? '');
  const [slug, setSlug] = useState(category?.slug ?? '');
  const [slugTouched, setSlugTouched] = useState(Boolean(category));
  const [icon, setIcon] = useState(category?.icon ?? '');
  const [imageKey, setImageKey] = useState<string | null>(category?.image_key ?? null);
  const [sort, setSort] = useState(String(category?.sort_order ?? nextSort));
  const [active, setActive] = useState(category?.is_active ?? true);
  const [error, setError] = useState('');

  const save = useMutation({
    mutationFn: async () => {
      const row = {
        name: name.trim(),
        slug: slugify(slug),
        icon: icon.trim() || null,
        // Only sent when the picture changed, so categories can still be saved before the column exists.
        ...(imageKey !== (category?.image_key ?? null) && { image_key: imageKey }),
        sort_order: Math.round(toNumber(sort) ?? 0),
        is_active: active,
      };
      if (category) must(await db().from('categories').update(row).eq('id', category.id));
      else must(await db().from('categories').insert(row));
    },
    onSuccess: () => {
      invalidate(...KEYS);
      toast(category ? 'Category saved' : 'Category added');
      onDone();
    },
    onError: (e) =>
      setError(
        /image_key/.test(String(e))
          ? 'Category pictures need the latest database update. Remove the picture to save, or apply the update first.'
          : friendlyError(e),
      ),
  });

  const remove = useMutation({
    mutationFn: async () => {
      must(await db().from('categories').delete().eq('id', category!.id));
    },
    onSuccess: () => {
      invalidate(...KEYS);
      toast('Category deleted');
      onDone();
    },
    onError: (e) => setError(friendlyError(e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (name.trim().length < 2) return setError('Enter a name.');
    if (!slugify(slug)) return setError('Enter a slug (letters and numbers).');
    save.mutate();
  };

  return (
    <form className="form-card" style={{ marginBottom: 10 }} onSubmit={submit}>
      <h4 style={{ margin: '0 0 10px' }}>{category ? `Edit ${category.name}` : 'New category'}</h4>
      <div className="field-row">
        <div className="field">
          <label htmlFor="cat-name">Name</label>
          <input
            id="cat-name"
            value={name}
            maxLength={60}
            onChange={(e) => {
              setName(e.target.value);
              if (!slugTouched) setSlug(slugify(e.target.value));
            }}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="cat-slug">Slug</label>
          <input
            id="cat-slug"
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value);
              setSlugTouched(true);
            }}
            onBlur={() => setSlug(slugify(slug))}
          />
          <div className="hint">Used in links, e.g. /explore?category={slugify(slug) || 'grocery'}</div>
        </div>
      </div>
      <CategoryImageField value={imageKey} onChange={setImageKey} emoji={icon.trim() || '🏷️'} />
      <div className="field-row">
        <div className="field">
          <label htmlFor="cat-icon">Icon (emoji, shown when there is no picture)</label>
          <input
            id="cat-icon"
            value={icon}
            maxLength={8}
            placeholder="🛒"
            onChange={(e) => setIcon(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="cat-sort">Sort order</label>
          <input id="cat-sort" type="number" value={sort} onChange={(e) => setSort(e.target.value)} />
          <div className="hint">Lower numbers show first.</div>
        </div>
      </div>
      <label className="check-row">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        Active (shown to customers and vendors)
      </label>
      {error && <p className="error-text">{error}</p>}
      <div className="btn-row">
        <button className="btn small" type="submit" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
        <button className="btn small secondary" type="button" onClick={onDone}>
          Cancel
        </button>
        {category && (
          <button
            className="btn small danger"
            type="button"
            disabled={remove.isPending}
            style={{ marginLeft: 'auto' }}
            onClick={() => {
              if (
                window.confirm(
                  `Delete "${category.name}"?\n\nShops and offers in this category keep working; they just ` +
                    'have no category until the vendor picks a new one. To hide it for now, untick Active instead.',
                )
              )
                remove.mutate();
            }}
          >
            Delete
          </button>
        )}
      </div>
    </form>
  );
}

/**
 * A square category picture: preview plus Upload / Replace / Remove. Uploads are centre-cropped on the device to
 * 512 x 512 WebP, so any photo works.
 */
function CategoryImageField({
  value,
  onChange,
  emoji,
}: {
  value: string | null;
  onChange: (key: string | null) => void;
  emoji: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      onChange(await uploadImage(file, 'categories', { square: 512 }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="field">
      <label>Picture (square)</label>
      <div className="cat-image-field">
        <div className="cat-image-preview">
          {value ? (
            <img src={mediaUrl(value)} alt="Category picture" width={96} height={96} />
          ) : (
            <span>{emoji}</span>
          )}
          {busy && <div className="cat-image-busy">Uploading…</div>}
        </div>
        <div>
          <div className="btn-row" style={{ marginTop: 0 }}>
            <button
              type="button"
              className="btn small"
              disabled={busy}
              onClick={() => input.current?.click()}
            >
              {value ? 'Replace' : '＋ Upload picture'}
            </button>
            {value && (
              <button
                type="button"
                className="btn small danger"
                disabled={busy}
                onClick={() => onChange(null)}
              >
                Remove
              </button>
            )}
          </div>
          <div className="hint">
            Any photo works: we crop the centre to a square (512 × 512). Without a picture, the emoji is
            shown.
          </div>
        </div>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          void pick(file);
        }}
      />
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
