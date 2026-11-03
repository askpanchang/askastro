import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <section className="space-y-3 py-12 text-center">
      <h1 className="text-3xl font-bold">Page not found</h1>
      <Link to="/" className="font-medium text-saffron underline-offset-4 hover:underline">
        Back to profiles
      </Link>
    </section>
  );
}
