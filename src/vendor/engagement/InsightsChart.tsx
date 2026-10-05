import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export interface ChartDay {
  /** "5 Oct" */
  label: string;
  views: number;
  clicks: number;
  whatsapp: number;
}

const series = [
  { key: 'views', name: 'Views', color: '#1760d9' },
  { key: 'clicks', name: 'Offer taps', color: '#ffdc16' },
  { key: 'whatsapp', name: 'WhatsApp leads', color: 'var(--color-green)' },
] as const;

/** Daily views, taps and WhatsApp leads. Loaded on demand so recharts stays out of the main bundle. */
export default function InsightsChart({ data }: { data: ChartDay[] }) {
  return (
    <div style={{ width: '100%', height: 240 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
          <CartesianGrid stroke="var(--color-line)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: 'var(--color-muted)' }}
            tickLine={false}
            axisLine={{ stroke: 'var(--color-line)' }}
            interval="preserveStartEnd"
            minTickGap={24}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 10, fill: 'var(--color-muted)' }}
            tickLine={false}
            axisLine={false}
            width={44}
          />
          <Tooltip
            contentStyle={{ borderRadius: 12, border: '1px solid var(--color-line)', fontSize: 12 }}
            labelStyle={{ fontWeight: 800 }}
          />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
          {series.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.name}
              stroke={s.color}
              strokeWidth={2.5}
              dot={data.length <= 31 ? { r: 2, fill: s.color, strokeWidth: 0 } : false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
