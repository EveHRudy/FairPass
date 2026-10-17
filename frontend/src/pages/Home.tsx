import EventCard from '../components/EventCard';
import { EmptyState, ErrorNote, Spinner } from '../components/ui';
import { useAsync } from '../hooks/useAsync';
import * as api from '../lib/api';

export default function Home() {
  const { data, error, loading, reload } = useAsync(() => api.getEvents(), []);
  const events = data ? [...data].sort((a, b) => a.date - b.date) : [];

  return (
    <>
      <section className="mb-12 max-w-3xl">
        <h1 className="text-4xl font-bold leading-[1.05] sm:text-6xl">Buy tickets that can't be scalped</h1>
        <p className="mt-5 max-w-xl text-lg text-mute">
          Every ticket is an NFT. Resales only happen here, at no more than the organizer's price cap, and the organizer
          earns a share of every resale.
        </p>
      </section>

      {loading && !data && <Spinner label="Loading events" />}
      {error && <ErrorNote message={error} onRetry={reload} />}
      {data && events.length === 0 && (
        <EmptyState title="No events yet" hint="Organizers can create the first event from the Organizer page." />
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        {events.map((e) => (
          <EventCard key={e.id} event={e} />
        ))}
      </div>
    </>
  );
}
