import type { RouteObject } from 'react-router';
import { Layout } from './components/Layout';
import { NotFoundPage } from './pages/NotFoundPage';
import { ProfileDetailPage } from './pages/ProfileDetailPage';
import { EditProfilePage, NewProfilePage } from './pages/ProfileFormPage';
import { ProfilesListPage } from './pages/ProfilesListPage';

export const routes: RouteObject[] = [
  {
    element: <Layout />,
    children: [
      { index: true, element: <ProfilesListPage /> },
      { path: 'profiles/new', element: <NewProfilePage /> },
      { path: 'profiles/:id', element: <ProfileDetailPage /> },
      { path: 'profiles/:id/edit', element: <EditProfilePage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
