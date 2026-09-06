import type { ReactNode } from 'react';

interface Props {
  icon?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  compact?: boolean;
}

export default function EmptyState({ icon = '📭', title, description, action, compact }: Props) {
  return (
    <div className={`state-block${compact ? ' compact' : ''}`} role="status">
      <div className="state-icon" aria-hidden="true">{icon}</div>
      <div className="state-title">{title}</div>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}
