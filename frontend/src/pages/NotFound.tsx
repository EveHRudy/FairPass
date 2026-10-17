import { Link } from 'react-router-dom';
import { EmptyState } from '../components/ui';

export default function NotFound() {
  return (
    <EmptyState
      title="Page not found"
      hint="The page you are looking for does not exist."
      action={
        <Link className="btn btn-primary" to="/">
          Back to events
        </Link>
      }
    />
  );
}
