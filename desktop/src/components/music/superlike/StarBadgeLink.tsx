import { Link } from 'react-router-dom';
import { StarBadge } from '../../layout/StarSubscription';

export function StarBadgeLink({ size = 'sm', onNavigate }: { size?: 'sm' | 'lg'; onNavigate?: () => void }) {
  return (
    <Link
      to="/star"
      onClick={onNavigate}
      className="inline-flex align-middle transition-transform duration-200 hover:scale-105"
    >
      <StarBadge size={size} />
    </Link>
  );
}
