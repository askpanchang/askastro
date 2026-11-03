import type { RouteObject } from 'react-router';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { NotFoundPage } from './pages/NotFoundPage';
import { EditProfilePage, NewProfilePage } from './pages/ProfileFormPage';
import { ProfilesListPage } from './pages/ProfilesListPage';

// Heavier pages (charts, Markdown) load on demand to keep the first load small.
const profileDetail = () =>
  import('./pages/ProfileDetailPage').then((m) => ({ Component: m.ProfileDetailPage }));
const session = () => import('./pages/SessionPage').then((m) => ({ Component: m.SessionPage }));

export const routes: RouteObject[] = [
  {
    element: <Layout />,
    hydrateFallbackElement: <Spinner />,
    children: [
      { index: true, element: <ProfilesListPage /> },
      { path: 'profiles/new', element: <NewProfilePage /> },
      { path: 'profiles/:id', lazy: profileDetail },
      { path: 'profiles/:id/edit', element: <EditProfilePage /> },
      { path: 'profiles/:id/kundali/:kid', lazy: profileDetail },
      { path: 'sessions/:id', lazy: session },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
