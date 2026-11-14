import React, { useId } from 'react';
import { CheckCircle2, Database, RefreshCw, XCircle } from 'lucide-react';
import { useSyncStatus } from '../../hooks/useSyncStatus';
import type { Chain, SyncRun } from '../../models';
import { formatDateTime } from '../comparison/format';
import { ErrorPanel, LoadingPanel } from '../comparison/StatusPanel';
import { cardClass } from '../comparison/styles';
import Button from '../ui/Button';

const STATUS: Record<SyncRun['status'], { label: string; className: string; icon: React.ReactNode }> = {
  ok: {
    label: 'OK',
    className: 'bg-green-100 text-green-800',
    icon: <CheckCircle2 className="h-3 w-3" aria-hidden="true" />,
  },
  error: {
    label: 'Failed',
    className: 'bg-red-100 text-red-800',
    icon: <XCircle className="h-3 w-3" aria-hidden="true" />,
  },
  running: {
    label: 'Running',
    className: 'bg-blue-100 text-blue-800',
    icon: <RefreshCw className="h-3 w-3 animate-spin" aria-hidden="true" />,
  },
};

/** The most recent run of each chain, chains in the order of the chain list. */
function latestRunPerChain(runs: SyncRun[], chains: Chain[]): Array<{ chainName: string; run: SyncRun }> {
  const latest = new Map<string | null, SyncRun>();
  for (const run of runs) {
    const current = latest.get(run.chainId);
    if (!current || run.startedAt > current.startedAt) latest.set(run.chainId, run);
  }
  const rows = [...latest].map(([chainId, run]) => ({
    chainName: chains.find((chain) => chain.id === chainId)?.name ?? (chainId === null ? 'All chains' : chainId),
    run,
  }));
  return rows.sort((a, b) => a.chainName.localeCompare(b.chainName));
}

const HEAD = 'px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-600';

/** Latest price-feed refreshes and a manual refresh. */
const PriceDataSection: React.FC<{ chains: Chain[] }> = ({ chains }) => {
  const headingId = useId();
  const sync = useSyncStatus();
  const rows = latestRunPerChain(sync.runs, chains);

  return (
    <section aria-labelledby={headingId} className={`${cardClass} p-4 sm:p-6`}>
      <header className="mb-4 flex items-start gap-3">
        <Database className="mt-0.5 h-5 w-5 text-green-600" aria-hidden="true" />
        <div>
          <h2 id={headingId} className="text-lg font-semibold text-gray-900">
            Price data
          </h2>
          <p className="text-sm text-gray-600">
            Prices are read from each chain&rsquo;s weekly feed. This is the latest refresh of every chain.
          </p>
        </div>
      </header>

      {sync.loading && <LoadingPanel label="Loading refresh history..." />}
      {sync.error && <ErrorPanel message={sync.error} onRetry={sync.reload} />}
      {!sync.loading && !sync.error && rows.length === 0 && (
        <p className="text-sm text-gray-600">No price feed has been loaded yet. Use the button below to load one.</p>
      )}
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <caption className="sr-only">Latest price refresh per chain</caption>
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className={`${HEAD} text-left`}>
                  Chain
                </th>
                <th scope="col" className={`${HEAD} text-left`}>
                  Finished
                </th>
                <th scope="col" className={`${HEAD} text-left`}>
                  Status
                </th>
                <th scope="col" className={`${HEAD} text-right`}>
                  Rows
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ chainName, run }) => {
                const status = STATUS[run.status];
                return (
                  <tr key={run.id} className="border-t border-gray-100 align-top">
                    <th scope="row" className="px-3 py-2 text-left font-medium text-gray-900">
                      {chainName}
                    </th>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-700">
                      {run.finishedAt ? formatDateTime(run.finishedAt) : 'Not finished'}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${status.className}`}
                      >
                        {status.icon}
                        {status.label}
                      </span>
                      {run.error && <p className="mt-1 max-w-xs text-xs text-red-700">{run.error}</p>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{run.rowsIngested.toLocaleString('en-US')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="button" isLoading={sync.refreshing} onClick={() => void sync.refresh()}>
          <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
          Refresh prices now
        </Button>
        {sync.lastRefresh && (
          <p role="status" className="inline-flex items-center gap-1.5 text-sm font-medium text-green-700">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            Refreshed: {sync.lastRefresh.reduce((total, run) => total + run.rowsIngested, 0).toLocaleString('en-US')}{' '}
            price rows read.
          </p>
        )}
        {sync.refreshError && (
          <p role="alert" className="text-sm font-medium text-red-700">
            Could not refresh: {sync.refreshError}
          </p>
        )}
      </div>
    </section>
  );
};

export default PriceDataSection;
