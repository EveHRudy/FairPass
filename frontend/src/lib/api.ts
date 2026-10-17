// Read-side data. In real mode everything comes from Person 5's Express backend (indexer).
import { API_URL, USE_MOCK } from './config';
import * as mock from './mock';
import type { Challenge, EventInfo, Listing, Ticket } from '../types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, init);
  } catch {
    throw new Error('Cannot reach the backend. Check that the server is running and VITE_API_URL is correct.');
  }
  if (!res.ok) throw new Error(`Backend returned ${res.status} for ${path}.`);
  return res.json() as Promise<T>;
}

// INTEGRATION (Person 5): GET /events must return EventInfo[] (see src/types.ts)
export const getEvents = (): Promise<EventInfo[]> => (USE_MOCK ? mock.getEvents() : request<EventInfo[]>('/events'));

// INTEGRATION (Person 5): GET /events/:id must return one EventInfo
export const getEvent = (id: number): Promise<EventInfo> => (USE_MOCK ? mock.getEvent(id) : request<EventInfo>(`/events/${id}`));

// INTEGRATION (Person 5): GET /listings must return Listing[] of active listings
export const getListings = (): Promise<Listing[]> => (USE_MOCK ? mock.getListings() : request<Listing[]>('/listings'));

// INTEGRATION (Person 5): GET /tickets/:address must return Ticket[] owned by that address
export const getTickets = (address: string): Promise<Ticket[]> =>
  USE_MOCK ? mock.getTickets(address) : request<Ticket[]>(`/tickets/${address}`);

export async function getOrganizerEvents(address: string): Promise<EventInfo[]> {
  const all = await getEvents();
  return all.filter((e) => e.organizer.toLowerCase() === address.toLowerCase() || (USE_MOCK && mock.isMockOrganizer(e)));
}

// INTEGRATION (Person 5): POST /checkin/challenge. Confirm the request body ({ ticketId }) and response shape
// ({ nonce, timestamp, expiresAt, message? }) match what the backend returns.
export const requestChallenge = (ticketId: number): Promise<Challenge> =>
  USE_MOCK
    ? mock.requestChallenge(ticketId)
    : request<Challenge>('/checkin/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId }),
      });
