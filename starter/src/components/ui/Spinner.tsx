import React from 'react';

interface SpinnerProps {
  label?: string;
  className?: string;
}

/** Centered loading indicator with an accessible label. */
const Spinner: React.FC<SpinnerProps> = ({ label = 'Loading...', className = '' }) => (
  <div role="status" className={`flex flex-col items-center justify-center py-12 text-gray-500 ${className}`}>
    <svg className="h-8 w-8 animate-spin text-green-600" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
    <p className="mt-3 text-sm">{label}</p>
  </div>
);

export default Spinner;
