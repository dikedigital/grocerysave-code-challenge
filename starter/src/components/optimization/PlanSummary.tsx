import React from 'react';
import type { OptimizationResult, Store } from '../../models';
import { notImplemented } from '../../utils/notImplemented';

interface PlanSummaryProps {
  result: OptimizationResult;
  storeById: Map<string, Store>;
}

/** Cheapest single store, best plan, and what splitting the shop saves. */
const PlanSummary: React.FC<PlanSummaryProps> = (props) => notImplemented(props);

export default PlanSummary;
