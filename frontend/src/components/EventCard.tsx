import { Link } from 'react-router-dom';
import Stub from './Stub';
import { fmtDate, fmtEth, isPast, remaining } from '../lib/format';
import type { EventInfo } from '../types';

export default function EventCard({ event }: { event: EventInfo }) {
  const left = remaining(event);
  const soldOut = left <= 0;
  return (
    <Link to={`/events/${event.id}`} className="block rounded-2xl transition-transform hover:-translate-y-0.5">
      <Stub
        main={
          <>
            <h2 className="text-2xl font-bold leading-snug">{event.name}</h2>
            <p className="mt-2 text-mute">{fmtDate(event.date)}</p>
            {event.venue && <p className="text-mute">{event.venue}</p>}
          </>
        }
        tail={
          <>
            <p className="text-2xl font-bold">{fmtEth(event.faceValue)} ETH</p>
            <p className={`mt-1 text-sm font-semibold ${soldOut || isPast(event) ? 'text-bad' : 'text-ok'}`}>
              {isPast(event) ? 'Event ended' : soldOut ? 'Sold out' : `${left} of ${event.supply} left`}
            </p>
            <p className="mt-3 inline-block rounded bg-cap-soft px-2 py-0.5 text-xs font-semibold text-cap">
              Resale capped at +{event.capPercent}%
            </p>
          </>
        }
      />
    </Link>
  );
}
