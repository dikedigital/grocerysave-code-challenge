import React from 'react';

interface PageHeaderProps {
  title: string;
  description: string;
  /** Buttons or links aligned to the right of the title on wide screens. */
  actions?: React.ReactNode;
}

const PageHeader: React.FC<PageHeaderProps> = ({ title, description, actions }) => (
  <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
    <div>
      <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
      <p className="mt-1 max-w-2xl text-sm text-gray-600">{description}</p>
    </div>
    {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
  </header>
);

export default PageHeader;
