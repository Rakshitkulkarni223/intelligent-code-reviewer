import type { ReactNode } from 'react';

interface Props {
  icon?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}

export default function EmptyState({ icon = '📭', title, description, action }: Props) {
  return (
    <div className="state-block" role="status">
      <div className="state-icon" aria-hidden="true">{icon}</div>
      <div className="state-title">{title}</div>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}
