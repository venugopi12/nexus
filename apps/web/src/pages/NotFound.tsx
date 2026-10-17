import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/primitives';
import { Compass } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="card mx-auto mt-10 max-w-lg">
      <EmptyState icon={<Compass className="size-5" />} title="Page not found" description="The page you’re looking for doesn’t exist or you may not have access to it." action={<Button asChild size="sm"><Link to="/">Back to overview</Link></Button>} />
    </div>
  );
}
