import { Bar, BarChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from 'recharts'
import { formatNumber } from './reportRules'

// Biểu đồ cột dùng chung cho 4 báo cáo 2.7.2. bars: [{ key, name, color }].
// horizontal: cột nằm ngang, hợp với nhãn dài (tên sách).
export default function ReportChart({ label, data, xKey, bars, horizontal = false, format = formatNumber }) {
  const categoryAxis = horizontal
    ? <YAxis type="category" dataKey={xKey} width={200} tick={{ fontSize: 12 }} />
    : <XAxis dataKey={xKey} tick={{ fontSize: 12 }} />
  const valueAxis = horizontal
    ? <XAxis type="number" allowDecimals={false} tickFormatter={format} tick={{ fontSize: 12 }} />
    : <YAxis allowDecimals={false} tickFormatter={format} width={90} tick={{ fontSize: 12 }} />
  return (
    <figure aria-label={label} className="rounded-lg border border-slate-200 bg-white p-4">
      <figcaption className="mb-2 text-sm font-semibold text-slate-700">{label}</figcaption>
      <BarChart
        responsive
        style={{ width: '100%', height: horizontal ? Math.max(160, data.length * 36 + 60) : 280 }}
        data={data}
        layout={horizontal ? 'vertical' : 'horizontal'}
        margin={{ top: 8, right: 16, bottom: 8, left: 8 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        {categoryAxis}
        {valueAxis}
        <Tooltip formatter={(value) => format(value)} />
        {bars.length > 1 && <Legend />}
        {bars.map((bar) => <Bar key={bar.key} dataKey={bar.key} name={bar.name} fill={bar.color} />)}
      </BarChart>
    </figure>
  )
}
