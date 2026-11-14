import React from 'react';
import { heatLegendSteps } from './heatColor';

/** Key to the colours of the price matrix. */
const HeatLegend: React.FC = () => (
  <div className="flex flex-wrap items-center gap-2 text-xs text-gray-700">
    <span>Lowest price in the row</span>
    <span className="flex overflow-hidden rounded border border-gray-300" aria-hidden="true">
      {heatLegendSteps().map((heat, index) => (
        <span key={index} className="h-4 w-6" style={{ backgroundColor: heat.style.backgroundColor }} />
      ))}
    </span>
    <span>highest. The lowest price is also bold; a dash on grey means the store does not sell the item.</span>
  </div>
);

export default HeatLegend;
