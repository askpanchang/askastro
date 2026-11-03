import { X } from '@phosphor-icons/react';
import { useEffect, useId, useRef, type ReactNode } from 'react';

export function Modal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal?.();
    if (!open && d.open) d.close?.();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="m-auto w-[min(40rem,calc(100%-2rem))] rounded-2xl border border-border bg-surface p-6 text-text shadow-xl backdrop:bg-black/50"
    >
      {open && (
        <>
          <div className="mb-4 flex items-start justify-between gap-4">
            <h2 id={titleId} className="text-xl font-semibold">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="text-muted hover:text-text"
              aria-label="Close"
            >
              <X size={18} aria-hidden />
            </button>
          </div>
          {children}
        </>
      )}
    </dialog>
  );
}
