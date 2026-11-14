import React, { useCallback, useEffect, useState } from 'react';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  /** Milliseconds before the toast closes itself; 0 keeps it until dismissed. */
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface ToastProps {
  toast: Toast;
  onDismiss: (id: string) => void;
}

const icons = {
  success: <CheckCircle className="h-5 w-5 text-green-500" aria-hidden="true" />,
  error: <AlertCircle className="h-5 w-5 text-red-500" aria-hidden="true" />,
  warning: <AlertTriangle className="h-5 w-5 text-yellow-500" aria-hidden="true" />,
  info: <Info className="h-5 w-5 text-blue-500" aria-hidden="true" />,
};

const borders = {
  success: 'border-green-500',
  error: 'border-red-500',
  warning: 'border-yellow-500',
  info: 'border-blue-500',
};

const ToastComponent: React.FC<ToastProps> = ({ toast, onDismiss }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setIsVisible(true), 10);
    return () => window.clearTimeout(timer);
  }, []);

  const { id, duration } = toast;
  const handleDismiss = useCallback(() => {
    setIsExiting(true);
    window.setTimeout(() => onDismiss(id), 300);
  }, [id, onDismiss]);

  useEffect(() => {
    if (!duration || duration <= 0) return;
    const timer = window.setTimeout(handleDismiss, duration);
    return () => window.clearTimeout(timer);
  }, [duration, handleDismiss]);

  return (
    <div
      role={toast.type === 'error' ? 'alert' : 'status'}
      className={`
        transform transition-all duration-300 ease-in-out
        border-l-4 bg-white shadow-lg rounded-lg p-4 max-w-sm w-full ${borders[toast.type]}
        ${isVisible && !isExiting ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'}
      `}
    >
      <div className="flex items-start">
        <div className="flex-shrink-0">{icons[toast.type]}</div>

        <div className="ml-3 flex-1 min-w-0">
          <h4 className="text-sm font-medium text-gray-900">{toast.title}</h4>
          {toast.message && <p className="mt-1 text-sm text-gray-600 break-words">{toast.message}</p>}
          {toast.action && (
            <div className="mt-2">
              <button
                type="button"
                onClick={toast.action.onClick}
                className="text-sm font-medium text-blue-600 hover:text-blue-500 focus:outline-none focus-visible:underline"
              >
                {toast.action.label}
              </button>
            </div>
          )}
        </div>

        <div className="ml-4 flex-shrink-0">
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Dismiss notification"
            className="inline-flex text-gray-400 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500 rounded"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
};

interface ToastContainerProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => (
  <div className="fixed top-4 right-4 left-4 sm:left-auto z-50 flex flex-col items-end space-y-2 pointer-events-none">
    {toasts.map((toast) => (
      <div key={toast.id} className="pointer-events-auto w-full max-w-sm">
        <ToastComponent toast={toast} onDismiss={onDismiss} />
      </div>
    ))}
  </div>
);

export default ToastComponent;
