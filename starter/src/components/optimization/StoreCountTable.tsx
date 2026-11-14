import React from 'react';
import type { ShoppingPlan, Store } from '../../models';
import { notImplemented } from '../../utils/notImplemented';

interface StoreCountTableProps {
  plans: ShoppingPlan[];
  bestPlan: ShoppingPlan | null;
  /** planKey of the plan shown in detail. */
  selectedKey: string | null;
  storeById: Map<string, Store>;
  onSelect: (plan: ShoppingPlan) => void;
}

/** The best plan for each number of stores, side by side; pick a row to see it in detail. */
const StoreCountTable: React.FC<StoreCountTableProps> = (props) => notImplemented(props);

export default StoreCountTable;
