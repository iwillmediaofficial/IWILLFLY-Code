import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

/** Loaded on demand by Analytics so recharts stays out of the admin entry chunk. */

export type SeriesDef = { key: string; label: string; color: string };

const axis = { fontSize: 11, fill: 'var(--color-muted)' };
const tooltipStyle = {
  borderRadius: 12,
  border: '1px solid var(--color-line)',
  fontSize: 12,
  boxShadow: '0 6px 18px rgba(23,36,63,0.12)',
};

function shortDay(day: string) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
  });
}

export function DailyLineChart({
  data,
  series,
}: {
  data: Record<string, number | string>[];
  series: SeriesDef[];
}) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid stroke="var(--color-line)" vertical={false} />
        <XAxis
          dataKey="day"
          tickFormatter={shortDay}
          tick={axis}
          tickLine={false}
          axisLine={false}
          minTickGap={16}
        />
        <YAxis allowDecimals={false} tick={axis} tickLine={false} axisLine={false} />
        <Tooltip labelFormatter={(d) => shortDay(String(d))} contentStyle={tooltipStyle} />
        {series.length > 1 && <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />}
        {series.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 5, strokeWidth: 2, stroke: '#fff' }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function DailyBarChart({
  data,
  series,
}: {
  data: Record<string, number | string>[];
  series: SeriesDef[];
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }} barGap={2}>
        <CartesianGrid stroke="var(--color-line)" vertical={false} />
        <XAxis
          dataKey="day"
          tickFormatter={shortDay}
          tick={axis}
          tickLine={false}
          axisLine={false}
          minTickGap={16}
        />
        <YAxis allowDecimals={false} tick={axis} tickLine={false} axisLine={false} />
        <Tooltip
          labelFormatter={(d) => shortDay(String(d))}
          contentStyle={tooltipStyle}
          cursor={{ fill: 'rgba(23,96,217,0.06)' }}
        />
        {series.length > 1 && <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />}
        {series.map((s) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label}
            fill={s.color}
            radius={[4, 4, 0, 0]}
            maxBarSize={18}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
