/** How often an open list is re-fetched so household members see each other's edits. */
export const LIST_POLL_INTERVAL_MS = 5_000;

/** How often the unread-notification badge in the navbar is refreshed. */
export const NOTIFICATION_POLL_INTERVAL_MS = 60_000;

/** Largest CSV file accepted by the bulk upload, in bytes. */
export const MAX_CSV_BYTES = 1_000_000;

/** Units the list parser normalises to, offered when adding or editing an item. */
export const ITEM_UNITS = [
  'each',
  'lb',
  'oz',
  'kg',
  'g',
  'l',
  'ml',
  'gal',
  'pack',
  'dozen',
  'can',
  'bottle',
  'box',
  'bag',
  'bunch',
] as const;

/** Sample file offered by the "Download template" link of the CSV upload. */
export const CSV_TEMPLATE = [
  'name,quantity,unit,note',
  'Milk,2,l,semi-skimmed',
  'Bananas,6,each,',
  'Chicken breast,1.5,lb,boneless',
  'Rice,1,kg,',
  '',
].join('\n');
