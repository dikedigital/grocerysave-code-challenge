import type { ShoppingPlan } from '../../models';
import { notImplemented } from '../../utils/notImplemented';

/** Identifies a plan by the set of stores it visits, regardless of route order. */
export function planKey(plan: ShoppingPlan): string {
  return notImplemented(plan);
}
