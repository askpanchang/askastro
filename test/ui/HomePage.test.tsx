import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../../src/routes';

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('HomePage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows API health once loaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          status: 'ok',
          app: 'Kundali Studio',
          db: 'ok',
          time: '2026-01-01T00:00:00Z',
        }),
      ),
    );
    renderAt('/');
    expect(screen.getByRole('heading', { name: 'Profiles' })).toBeInTheDocument();
    expect(await screen.findByText(/API ok · database ok/)).toBeInTheDocument();
  });

  it('shows an error state when the API fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 500 })),
    );
    renderAt('/');
    expect(await screen.findByText('API unreachable')).toBeInTheDocument();
  });

  it('renders a not-found page for unknown routes', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({})),
    );
    renderAt('/does-not-exist');
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });
});
