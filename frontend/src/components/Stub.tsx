import type { ReactNode } from 'react';

/** Ticket-shaped card: details on the left, tear-off section on the right (below on phones). */
export default function Stub({ main, tail, className = '' }: { main: ReactNode; tail: ReactNode; className?: string }) {
  return (
    <div className={`stub ${className}`}>
      <div className="stub-main">{main}</div>
      <div className="stub-tail">{tail}</div>
    </div>
  );
}
