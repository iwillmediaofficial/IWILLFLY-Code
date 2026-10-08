import { useMemo, type CSSProperties } from 'react';
import { useCategories } from '../lib/queries';
import { mediaUrl } from '../lib/supabase';
import type { Category } from '../lib/types';

type CategoryRef = {
  id?: number | null;
  slug?: string | null;
  icon?: string | null;
  image_key?: string | null;
};

/**
 * Finds a category's picture and emoji from the cached category list, by id or slug. Search results and
 * embedded rows only carry the slug, id or emoji, so this is how they get the picture.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useCategoryLookup() {
  const { data = [] } = useCategories();
  return useMemo(() => {
    const byId = new Map(data.map((c) => [c.id, c]));
    const bySlug = new Map(data.map((c) => [c.slug, c]));
    return (ref: CategoryRef | null | undefined): Category | undefined =>
      ref
        ? ((ref.id != null ? byId.get(ref.id) : undefined) ?? (ref.slug ? bySlug.get(ref.slug) : undefined))
        : undefined;
  }, [data]);
}

/**
 * A category's picture in a rounded square, or its emoji when it has none.
 * `size` sets a fixed square in px; `fill` makes the picture cover its container (e.g. a card thumbnail).
 */
export function CategoryIcon({
  category,
  fallback = '🏷️',
  size,
  fill = false,
  style,
}: {
  category: CategoryRef | null | undefined;
  fallback?: string;
  size?: number;
  fill?: boolean;
  style?: CSSProperties;
}) {
  const lookup = useCategoryLookup();
  const found = lookup(category);
  const imageKey = category?.image_key ?? found?.image_key ?? null;
  const icon = category?.icon ?? found?.icon ?? fallback;
  if (!imageKey) return <>{icon}</>;
  const box: CSSProperties = fill
    ? { width: '100%', height: '100%' }
    : { width: size ?? 24, height: size ?? 24, borderRadius: Math.max(4, Math.round((size ?? 24) * 0.28)) };
  return (
    <img
      className="cat-img"
      src={mediaUrl(imageKey)}
      alt=""
      loading="lazy"
      decoding="async"
      width={size ?? 512}
      height={size ?? 512}
      style={{ ...box, ...style }}
    />
  );
}
