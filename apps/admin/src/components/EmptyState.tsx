import { PackageOpen } from 'lucide-react';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
}

export default function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      <div className="w-16 h-16 rounded-2xl bg-surface-linen flex items-center justify-center mb-4">
        {icon || <PackageOpen size={28} strokeWidth={1.75} className="text-muted" />}
      </div>
      <h3 className="text-lg font-bold font-display text-ink mb-1">{title}</h3>
      <p className="text-sm font-body text-gray mb-6 text-center max-w-sm">{description}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="h-11 px-5 bg-brand text-white rounded-xl text-sm font-semibold font-display hover:bg-brand-mid transition-colors"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
