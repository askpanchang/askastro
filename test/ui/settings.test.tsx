import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi, renderApp } from './renderApp';

afterEach(() => vi.unstubAllGlobals());

const DEEPSEEK = '@cf/deepseek-ai/deepseek-v4.1-flash-1017';
const GLM = '@cf/zai-org/glm-5.3-flash';
const choice = (model: string) => ({
  model,
  defaultModel: DEEPSEEK,
  updatedBy: model === DEEPSEEK ? null : 'admin@example.com',
  updatedAt: model === DEEPSEEK ? null : '2026-11-04T10:00:00.000Z',
  options: [
    { id: DEEPSEEK, label: 'DeepSeek V4.1 Flash', billing: 'credits', summary: 'Most accurate.' },
    { id: GLM, label: 'GLM 5.3 Flash', billing: 'credits', summary: 'Cheapest.' },
    { id: '@cf/openai/gpt-oss-120b', label: 'gpt-oss-120b', billing: 'free', summary: 'Free.' },
  ],
});

describe('settings page', () => {
  it('lets an admin switch the answer model', async () => {
    const api = mockApi({
      'GET /api/usage': () =>
        Response.json({ error: { code: 'X', message: 'x' } }, { status: 500 }),
      'GET /api/settings/model': () => Response.json(choice(DEEPSEEK)),
      'PUT /api/settings/model': (_u, init) =>
        Response.json(choice((JSON.parse(String(init.body)) as { model: string }).model)),
    });
    renderApp('/settings');
    const deepseek = await screen.findByRole('radio', { name: /DeepSeek V4\.1 Flash/ });
    expect(deepseek).toBeChecked();
    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: /GLM 5\.3 Flash/ }));
    expect(await screen.findByText('New questions will use GLM 5.3 Flash')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('radio', { name: /GLM/ })).toBeChecked());
    expect(screen.getByText(/Last changed by admin@example.com/)).toBeInTheDocument();
    const put = api.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(JSON.parse(String(put?.[1]?.body))).toEqual({ model: GLM });
  });

  it('is hidden from family members', async () => {
    mockApi({
      'GET /api/me': () => Response.json({ email: 'kid@example.com', isAdmin: false }),
    });
    renderApp('/settings');
    expect(await screen.findByText('Only an admin can change app settings.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });
});
