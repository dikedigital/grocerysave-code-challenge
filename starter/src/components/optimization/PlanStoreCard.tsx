import React from 'react';
import type { PlanStore, Store } from '../../models';
import { notImplemented } from '../../utils/notImplemented';

interface PlanStoreCardProps {
  planStore: PlanStore;
  store: Store | undefined;
  /** 1-based position in the route, when the plan has one. */
  stopNumber: number | null;
}

/** What to buy at one store of a plan, with the subtotal. */
const PlanStoreCard: React.FC<PlanStoreCardProps> = (props) => notImplemented(props);

export default PlanStoreCard;
