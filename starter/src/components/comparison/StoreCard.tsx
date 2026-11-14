import React from 'react';
import type { Store, StoreTotal } from '../../models';
import { notImplemented } from '../../utils/notImplemented';

interface StoreCardProps {
  store: Store;
  total: StoreTotal;
  /** Labels of the priceable items this store does not sell. */
  missingLabels: string[];
  isCheapest: boolean;
}

/** One store's basket total, shown as a card on narrow screens. */
const StoreCard: React.FC<StoreCardProps> = (props) => notImplemented(props);

export default StoreCard;
