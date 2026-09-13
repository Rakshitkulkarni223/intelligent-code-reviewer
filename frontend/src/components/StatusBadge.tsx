import type { ReviewStatus } from '../types';
import { formatStatus, statusBg, statusColor } from '../lib/reviewStatus';

export default function StatusBadge({ status }: { status: ReviewStatus }) {
  return (
    <span className="badge" style={{ background: statusBg(status), color: statusColor(status), borderColor: 'transparent' }}>
      {formatStatus(status)}
    </span>
  );
}
