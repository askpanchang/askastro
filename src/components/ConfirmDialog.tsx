import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from './ui';

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal?.();
    if (!open && d.open) d.close?.();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      aria-labelledby="confirm-title"
      className="m-auto w-[min(28rem,calc(100%-2rem))] rounded-2xl border border-border bg-surface p-6 text-text shadow-xl backdrop:bg-black/50"
    >
      {open && (
        <>
          <h2 id="confirm-title" className="text-xl font-semibold">
            {title}
          </h2>
          <div className="mt-2 text-sm text-muted">{children}</div>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="secondary" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={onConfirm} loading={busy}>
              {confirmLabel}
            </Button>
          </div>
        </>
      )}
    </dialog>
  );
}
