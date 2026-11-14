import React from 'react';
import { AlertCircle, CheckCircle, Info } from 'lucide-react';

interface AlertProps {
  variant?: 'error' | 'success' | 'info';
  children: React.ReactNode;
  className?: string;
}

const styles = {
  error: { box: 'bg-red-50 border-red-200 text-red-700', icon: AlertCircle, role: 'alert' as const },
  success: { box: 'bg-green-50 border-green-200 text-green-700', icon: CheckCircle, role: 'status' as const },
  info: { box: 'bg-blue-50 border-blue-200 text-blue-700', icon: Info, role: 'status' as const },
};

/** Inline message box. Errors are announced to screen readers immediately. */
const Alert: React.FC<AlertProps> = ({ variant = 'error', children, className = '' }) => {
  const { box, icon: Icon, role } = styles[variant];
  return (
    <div role={role} className={`flex items-start rounded-md border p-3 text-sm ${box} ${className}`}>
      <Icon className="mr-2 mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
      <div className="min-w-0 break-words">{children}</div>
    </div>
  );
};

export default Alert;
