import React, { useMemo } from 'react';
import {
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  type ChartData,
  type ChartOptions,
  type PointStyle,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import type { PricePoint } from '../../models';
import { formatMoney } from '../../utils/money';
import { formatFeedDate } from './format';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

/** Categorical series colours, in fixed order (blue, orange, aqua, yellow, magenta, green, violet, red). */
const SERIES_COLORS = [
  '#2a78d6',
  '#eb6834',
  '#1baf7a',
  '#eda100',
  '#e87ba4',
  '#008300',
  '#6250d6',
  '#e34948',
];
/** A second cue next to colour: every series also gets its own marker shape. */
const SERIES_POINTS: PointStyle[] = ['circle', 'rect', 'triangle', 'rectRot', 'star', 'crossRot', 'cross', 'rectRounded'];

interface PriceHistoryChartProps {
  points: PricePoint[];
  /** Display name per store id; unknown ids are shown as they are. */
  storeNames: Record<string, string>;
  /** Accessible name of the chart. */
  label: string;
}

interface Series {
  storeId: string;
  name: string;
  /** Price per date, aligned with `dates`; null where the store has no snapshot. */
  prices: (number | null)[];
}

function buildSeries(points: PricePoint[], storeNames: Record<string, string>) {
  const dates = [...new Set(points.map((point) => point.date))].sort();
  const storeIds = [...new Set(points.map((point) => point.storeId))].sort((a, b) =>
    (storeNames[a] ?? a).localeCompare(storeNames[b] ?? b)
  );
  const priceAt = new Map(points.map((point) => [`${point.storeId}|${point.date}`, point.price]));
  const series: Series[] = storeIds.map((storeId) => ({
    storeId,
    name: storeNames[storeId] ?? storeId,
    prices: dates.map((date) => priceAt.get(`${storeId}|${date}`) ?? null),
  }));
  return { dates, series };
}

/** Line chart of weekly prices, one series per store, with the same data available as a table. */
const PriceHistoryChart: React.FC<PriceHistoryChartProps> = ({ points, storeNames, label }) => {
  const { dates, series } = useMemo(() => buildSeries(points, storeNames), [points, storeNames]);

  const data: ChartData<'line'> = {
    labels: dates.map(formatFeedDate),
    datasets: series.map((entry, index) => ({
      label: entry.name,
      data: entry.prices,
      borderColor: SERIES_COLORS[index % SERIES_COLORS.length],
      backgroundColor: SERIES_COLORS[index % SERIES_COLORS.length],
      pointStyle: SERIES_POINTS[index % SERIES_POINTS.length],
      borderDash: index >= SERIES_COLORS.length ? [6, 4] : [],
      borderWidth: 2,
      pointRadius: 4,
      pointHoverRadius: 6,
      tension: 0,
      spanGaps: true,
    })),
  };

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { position: 'bottom', labels: { usePointStyle: true } },
      tooltip: {
        callbacks: {
          label: (item) =>
            item.parsed.y === null ? `${item.dataset.label}: n/a` : `${item.dataset.label}: ${formatMoney(item.parsed.y)}`,
        },
      },
    },
    scales: {
      y: { ticks: { callback: (value) => formatMoney(Number(value)) } },
      x: { grid: { display: false } },
    },
  };

  return (
    <div>
      <div className="h-64 sm:h-80">
        <Line data={data} options={options} role="img" aria-label={label} />
      </div>

      <details className="mt-4 text-sm">
        <summary className="cursor-pointer rounded font-medium text-green-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500">
          View the same data as a table
        </summary>
        <div className="mt-2 overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-0 text-sm">
            <caption className="sr-only">{label}</caption>
            <thead>
              <tr>
                <th scope="col" className="border-b border-gray-200 px-3 py-2 text-left font-semibold text-gray-700">
                  Week
                </th>
                {series.map((entry) => (
                  <th
                    key={entry.storeId}
                    scope="col"
                    className="border-b border-gray-200 px-3 py-2 text-right font-semibold text-gray-700"
                  >
                    {entry.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dates.map((date, dateIndex) => (
                <tr key={date}>
                  <th scope="row" className="border-b border-gray-100 px-3 py-1.5 text-left font-normal text-gray-700">
                    {formatFeedDate(date)}
                  </th>
                  {series.map((entry) => {
                    const price = entry.prices[dateIndex];
                    return (
                      <td key={entry.storeId} className="border-b border-gray-100 px-3 py-1.5 text-right tabular-nums">
                        {price === null ? '—' : formatMoney(price)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
};

export default PriceHistoryChart;
