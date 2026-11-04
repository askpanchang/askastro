import { useMe } from '../api/me';
import { useModelChoice, useSetModel } from '../api/settings';
import { useToast } from '../components/Toaster';
import { ErrorState, Spinner } from '../components/ui';

const dateFmt = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

export function SettingsPage() {
  const me = useMe();
  const isAdmin = me.data?.isAdmin === true;
  const choice = useModelChoice(isAdmin);
  const setModel = useSetModel();
  const toast = useToast();

  if (me.isPending) return <Spinner />;
  if (!isAdmin) return <ErrorState message="Only an admin can change app settings." />;
  if (choice.isPending) return <Spinner label="Loading settings…" />;
  if (choice.isError) {
    return <ErrorState message={choice.error.message} onRetry={() => void choice.refetch()} />;
  }
  const c = choice.data;
  const pending = setModel.isPending ? setModel.variables : null;

  return (
    <section className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-sm text-muted">
          Admins only. Changes apply to everyone’s next question.
        </p>
      </div>

      <fieldset className="space-y-3" disabled={setModel.isPending}>
        <legend className="mb-1 text-xl font-semibold">AI model for answers</legend>
        <p className="text-sm text-muted">
          Paid models are billed to your AI Gateway credits. gpt-oss-120b uses the free daily
          allowance (10,000 neurons) and needs no credits.
        </p>
        {c.options.map((o, i) => {
          const selected = (pending ?? c.model) === o.id;
          return (
            <label
              key={o.id}
              className={`flex cursor-pointer gap-3 rounded-xl border bg-surface p-4 transition hover:bg-surface-2 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-saffron/40 ${selected ? 'border-saffron' : 'border-border'}`}
            >
              <input
                type="radio"
                name="model"
                value={o.id}
                checked={selected}
                className="mt-1 accent-saffron"
                onChange={() =>
                  setModel.mutate(o.id, {
                    onSuccess: () => toast.success(`New questions will use ${o.label}`),
                    onError: (e) => toast.error(e.message),
                  })
                }
              />
              <span className="space-y-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{o.label}</span>
                  {i === 0 && (
                    <span className="rounded-full bg-saffron/15 px-2 py-0.5 text-xs font-semibold text-saffron">
                      Recommended
                    </span>
                  )}
                  <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">
                    {o.billing === 'credits' ? 'Prepaid credits' : 'Free daily allowance'}
                  </span>
                </span>
                <span className="block text-sm text-muted">{o.summary}</span>
              </span>
            </label>
          );
        })}
      </fieldset>

      <p className="text-xs text-muted">
        {c.updatedBy && c.updatedAt
          ? `Last changed by ${c.updatedBy} on ${dateFmt.format(new Date(c.updatedAt))}.`
          : 'Using the default model from the deploy settings.'}{' '}
        Existing answers keep the model that wrote them.
      </p>
    </section>
  );
}
