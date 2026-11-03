import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { ToastProvider } from '../../src/components/Toaster';
import { routes } from '../../src/routes';

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>;

/** Stub fetch with a route table: { 'GET /api/profiles': handler }. */
export function mockApi(table: Record<string, Handler>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init.method ?? 'GET').toUpperCase();
    // Default identity: the admin (override with 'GET /api/me' in the table).
    const handler =
      table[`${method} ${url.pathname}`] ??
      (`${method} ${url.pathname}` === 'GET /api/me'
        ? () => Response.json({ email: 'admin@example.com', isAdmin: true })
        : undefined);
    if (!handler) {
      return Response.json({ error: { code: 'NOT_FOUND', message: 'nope' } }, { status: 404 });
    }
    return handler(url, init);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

export function renderApp(path: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const utils = render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { ...utils, router };
}

export const PROFILE = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Arjun Sharma',
  gender: 'm',
  dob: '1990-08-15',
  tob: '14:30',
  tobUnknown: false,
  place: 'Hyderabad, Telangana, India',
  lat: 17.385,
  lon: 78.4867,
  tz: 'Asia/Kolkata',
  notes: null,
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-01T10:00:00.000Z',
} as const;
