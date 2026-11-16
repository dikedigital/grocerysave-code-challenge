import type { FeedSnapshot } from '../../providers';
import { planPriceRows, toSyncRun } from '../syncPrices';

const row = (sku: string, price: number, regularPrice = price, onSale = false) => ({ sku, price, regularPrice, onSale });
const products = new Map([['GS-001', 'p1'], ['GS-002', 'p2']]);

describe('planPriceRows (pure: what the sync writes for one chain)', () => {
  it('one row per store, per snapshot, per known SKU', () => {
    const snapshots: FeedSnapshot[] = [
      { date: '2026-11-02', rows: [row('GS-001', 3.2), row('GS-002', 1.5, 2, true)], skipped: 0 },
      { date: '2026-11-09', rows: [row('GS-001', 3.1)], skipped: 3 },
    ];
    expect(planPriceRows(snapshots, products, ['s1', 's2'])).toEqual({
      rows: [
        { storeId: 's1', productId: 'p1', price: 3.2, regularPrice: 3.2, onSale: false, date: '2026-11-02' },
        { storeId: 's2', productId: 'p1', price: 3.2, regularPrice: 3.2, onSale: false, date: '2026-11-02' },
        { storeId: 's1', productId: 'p2', price: 1.5, regularPrice: 2, onSale: true, date: '2026-11-02' },
        { storeId: 's2', productId: 'p2', price: 1.5, regularPrice: 2, onSale: true, date: '2026-11-02' },
        { storeId: 's1', productId: 'p1', price: 3.1, regularPrice: 3.1, onSale: false, date: '2026-11-09' },
        { storeId: 's2', productId: 'p1', price: 3.1, regularPrice: 3.1, onSale: false, date: '2026-11-09' },
      ],
      unknownSkus: [],
      unknownRowCount: 0,
      duplicates: [],
    });
  });

  it('ignores and reports SKUs that are not in the catalog', () => {
    const snapshots: FeedSnapshot[] = [
      { date: '2026-11-02', rows: [row('GS-999', 4.99), row('GS-001', 3.2)], skipped: 0 },
      { date: '2026-11-09', rows: [row('GS-999', 4.99), row('GS-777', 1)], skipped: 0 },
    ];
    const plan = planPriceRows(snapshots, products, ['s1']);
    expect(plan.rows.map((r) => r.productId)).toEqual(['p1']);
    expect(plan.unknownSkus).toEqual(['GS-777', 'GS-999']);
    expect(plan.unknownRowCount).toBe(3);
  });

  it('a SKU repeated in one snapshot keeps its last row and is reported (D-66)', () => {
    const snapshots: FeedSnapshot[] = [{ date: '2026-11-09', rows: [row('GS-001', 3.2), row('GS-002', 1), row('GS-001', 2.99, 3.2, true)], skipped: 0 }];
    const plan = planPriceRows(snapshots, products, ['s1']);
    expect(plan.rows).toEqual([
      { storeId: 's1', productId: 'p2', price: 1, regularPrice: 1, onSale: false, date: '2026-11-09' },
      { storeId: 's1', productId: 'p1', price: 2.99, regularPrice: 3.2, onSale: true, date: '2026-11-09' },
    ]);
    expect(plan.duplicates).toEqual([{ date: '2026-11-09', sku: 'GS-001' }]);
  });

  it('the same SKU on different dates is not a duplicate', () => {
    const snapshots: FeedSnapshot[] = [
      { date: '2026-11-02', rows: [row('GS-001', 3.2)], skipped: 0 },
      { date: '2026-11-09', rows: [row('GS-001', 3.2)], skipped: 0 },
    ];
    expect(planPriceRows(snapshots, products, ['s1']).duplicates).toEqual([]);
  });

  it('no stores or no snapshots: nothing to write, unknown SKUs still reported', () => {
    expect(planPriceRows([], products, ['s1'])).toEqual({ rows: [], unknownSkus: [], unknownRowCount: 0, duplicates: [] });
    const plan = planPriceRows([{ date: '2026-11-09', rows: [row('GS-001', 1), row('GS-999', 1)], skipped: 0 }], products, []);
    expect(plan.rows).toEqual([]);
    expect(plan.unknownSkus).toEqual(['GS-999']);
  });
});

describe('toSyncRun (sync_runs row -> SyncRun model)', () => {
  it('camelCase, numeric id (bigserial comes back as a string), ISO timestamps', () => {
    expect(toSyncRun({
      id: '42', chain_id: 'harvest', started_at: new Date('2026-11-15T19:53:17.998Z'), finished_at: new Date('2026-11-15T19:53:18.026Z'),
      status: 'ok', rows_ingested: 136, error: null,
    })).toEqual({
      id: 42, chainId: 'harvest', startedAt: '2026-11-15T19:53:17.998Z', finishedAt: '2026-11-15T19:53:18.026Z',
      status: 'ok', rowsIngested: 136, error: null,
    });
  });

  it('a run still running has finishedAt null; an error keeps its message', () => {
    expect(toSyncRun({ id: 1, chain_id: null, started_at: '2026-11-15T19:53:17.998Z', finished_at: null, status: 'error', rows_ingested: 0, error: 'boom' }))
      .toEqual({ id: 1, chainId: null, startedAt: '2026-11-15T19:53:17.998Z', finishedAt: null, status: 'error', rowsIngested: 0, error: 'boom' });
  });
});
