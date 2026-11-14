import React from 'react';
import type { ComparisonResponse, ComparisonRow } from '../../models';
import { notImplemented } from '../../utils/notImplemented';

interface ComparisonTableProps {
  data: ComparisonResponse;
  /** Key of the row whose price history is open. */
  selectedKey: string | null;
  onSelectRow: (row: ComparisonRow) => void;
}

/**
 * The price matrix: items down, stores across, heat-coloured per row, with summary columns on
 * the right and total / comparison rows in the footer. Scrolls with a sticky first column and header.
 */
const ComparisonTable: React.FC<ComparisonTableProps> = (props) => notImplemented(props);

export default ComparisonTable;
