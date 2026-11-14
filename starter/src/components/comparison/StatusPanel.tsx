import React from 'react';
import { AlertTriangle, Inbox, Loader2 } from 'lucide-react';
import Button from '../ui/Button';
import { cardClass } from './styles';

export const LoadingPanel: React.FC<{ label: string }> = ({ label }) => (
  <div
    role="status"
    className={`${cardClass} flex items-center justify-center gap-3 px-6 py-12 text-gray-600`}
  >
    <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
    <span>{label}</span>
  </div>
);

interface ErrorPanelProps {
  message: string;
  onRetry?: () => void;
}

export const ErrorPanel: React.FC<ErrorPanelProps> = ({ message, onRetry }) => (
  <div
    role="alert"
    className="flex flex-col items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-5 text-red-800 sm:flex-row sm:items-center"
  >
    <AlertTriangle className="h-5 w-5 flex-shrink-0" aria-hidden="true" />
    <p className="flex-1 text-sm">{message}</p>
    {onRetry && (
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    )}
  </div>
);

interface EmptyPanelProps {
  title: string;
  children?: React.ReactNode;
}

export const EmptyPanel: React.FC<EmptyPanelProps> = ({ title, children }) => (
  <div className={`${cardClass} flex flex-col items-center px-6 py-12 text-center`}>
    <Inbox className="mb-3 h-10 w-10 text-gray-300" aria-hidden="true" />
    <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
    {children && <div className="mt-2 max-w-xl text-sm text-gray-600">{children}</div>}
  </div>
);
