import { useMemo } from 'react';
import { useLocations } from '../lib/queries';
import type { LocationNode } from '../lib/types';

/** A select of active areas (leaf locations), labelled with their city. */
export function AreaPicker({
  value,
  onChange,
  label = 'Area',
}: {
  value: number | null;
  onChange: (area: LocationNode | null) => void;
  label?: string;
}) {
  const { data = [] } = useLocations();
  const areas = useMemo(() => {
    const byId = new Map(data.map((l) => [l.id, l]));
    return data
      .filter((l) => l.kind === 'area' && l.is_active)
      .map((a) => ({ area: a, city: a.parent_id != null ? (byId.get(a.parent_id)?.name ?? '') : '' }))
      .sort((x, y) => x.city.localeCompare(y.city) || x.area.name.localeCompare(y.area.name));
  }, [data]);
  return (
    <div className="field">
      <label>{label}</label>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(areas.find((a) => a.area.id === Number(e.target.value))?.area ?? null)}
      >
        <option value="">Choose an area</option>
        {areas.map(({ area, city }) => (
          <option key={area.id} value={area.id}>
            {area.name}
            {city ? `, ${city}` : ''}
          </option>
        ))}
      </select>
    </div>
  );
}
