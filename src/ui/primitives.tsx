import {
  useEffect,
  useLayoutEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { X, ChevronDown, Check } from 'lucide-react';

export function Key({ children }: { children: ReactNode }) {
  return <kbd>{children}</kbd>;
}
export function IconButton({
  label,
  children,
  onClick,
  active,
  disabled = false,
  className = '',
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`icon-btn ${active ? 'is-active' : ''} ${className}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
export function Popover({
  label,
  children,
  selected = false,
  align = 'left',
  className = '',
  chevron = true,
  ariaLabel,
}: {
  label: ReactNode;
  children: (close: () => void) => ReactNode;
  selected?: boolean;
  align?: 'left' | 'right';
  className?: string;
  chevron?: boolean;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const arrowOpen = useRef(0);
  const id = useId();
  const close = () => {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  };
  const rows = () =>
    Array.from(content.current?.querySelectorAll<HTMLButtonElement>('.menu-row:not(:disabled)') ?? []);
  useLayoutEffect(() => {
    if (!open || !content.current || !trigger.current) return;
    const panel = content.current,
      anchor = trigger.current;
    function place() {
      const rect = anchor.getBoundingClientRect(),
        gap = 5,
        edge = 7;
      const below = window.innerHeight - rect.bottom - gap - edge,
        above = rect.top - gap - edge;
      const down = below >= panel.scrollHeight || below >= above;
      panel.style.maxHeight = `${Math.max(36, down ? below : above)}px`;
      const w = panel.offsetWidth,
        h = panel.offsetHeight;
      panel.style.left = `${Math.round(Math.max(edge, Math.min(window.innerWidth - w - edge, align === 'right' ? rect.right - w : rect.left)))}px`;
      panel.style.top = `${Math.round(down ? rect.bottom + gap : rect.top - gap - h)}px`;
    }
    place();
    const observer = new ResizeObserver(place);
    observer.observe(panel);
    observer.observe(anchor);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    if (arrowOpen.current) {
      const items = rows();
      items.at(arrowOpen.current === 1 ? 0 : -1)?.focus();
      arrowOpen.current = 0;
    }
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, align]);
  function arrow(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const target = e.target as HTMLElement;
    if (target !== trigger.current && !target.classList.contains('menu-row')) return;
    const step = e.key === 'ArrowDown' ? 1 : -1;
    if (!open && target === trigger.current) {
      e.preventDefault();
      arrowOpen.current = step;
      setOpen(true);
      return;
    }
    const items = rows();
    if (!items.length) return;
    const current = items.indexOf(target as HTMLButtonElement);
    const index =
      current < 0 ? (step > 0 ? 0 : items.length - 1) : (current + step + items.length) % items.length;
    e.preventDefault();
    items[index].focus();
  }
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const keys = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        close();
      }
    };
    const focus = (e: FocusEvent) => {
      if (e.relatedTarget && !root.current?.contains(e.relatedTarget as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    root.current?.addEventListener('keydown', keys);
    root.current?.addEventListener('focusout', focus);
    const el = root.current;
    return () => {
      document.removeEventListener('pointerdown', outside);
      el?.removeEventListener('keydown', keys);
      el?.removeEventListener('focusout', focus);
    };
  }, [open]);
  return (
    <div className={`popover-root ${className}`} ref={root} onKeyDown={arrow}>
      <button
        ref={trigger}
        className={`popover-trigger ${selected ? 'is-active' : ''}`}
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        {label}
        {chevron && <ChevronDown size={12} />}
      </button>
      {open && (
        <div className="popover" ref={content} id={id}>
          {children(close)}
        </div>
      )}
    </div>
  );
}
export function MenuRow({
  children,
  onClick,
  selected,
  disabled = false,
}: {
  children: ReactNode;
  onClick: () => void;
  selected?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      className={`menu-row ${selected ? 'is-active' : ''}`}
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      disabled={disabled}
    >
      {children}
      {selected && <Check size={13} className="menu-check" aria-hidden="true" />}
    </button>
  );
}
export function Dialog({
  title,
  kicker,
  children,
  onClose,
  className = '',
  id: externalId,
}: {
  title: string;
  kicker?: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
  id?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const generated = useId(),
    id = externalId ?? generated;
  const callback = useRef(onClose);
  callback.current = onClose;
  useLayoutEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    dialog.querySelector<HTMLElement>('[data-initial-focus]')?.focus();
    const escape = (e: Event) => {
      e.preventDefault();
      callback.current();
    };
    dialog.addEventListener('cancel', escape);
    return () => {
      dialog.removeEventListener('cancel', escape);
      dialog.close();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={id}
      className={`dialog ${className}`}
      onClick={(e) => {
        if (e.target === ref.current) {
          const r = ref.current.getBoundingClientRect();
          if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
            onClose();
        }
      }}
    >
      <div className="dialog-header">
        <div>
          {kicker && <div className="eyebrow">{kicker}</div>}
          <h2 id={id}>{title}</h2>
        </div>
        <IconButton label="Close dialog" onClick={onClose}>
          <X size={17} />
        </IconButton>
      </div>
      {children}
    </dialog>
  );
}

export function ResizeRail({
  label,
  orientation,
  value,
  min,
  max,
  onChange,
  onReset,
  edge,
  className = '',
}: {
  label: string;
  orientation: 'horizontal' | 'vertical';
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  onReset: () => void;
  edge: 'leading' | 'trailing';
  className?: string;
}) {
  const drag = useRef<{ pointer: number; at: number; size: number } | undefined>(undefined);
  const isSide = orientation === 'vertical',
    direction = edge === 'leading' ? 1 : -1;
  const valid = (n: number) => Math.round(Math.max(min, Math.min(max, n)));
  return (
    <div
      className={`resize-rail ${className}`}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={orientation}
      aria-valuenow={valid(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      title={`${label} · drag or use arrow keys; double-click to reset`}
      onDoubleClick={onReset}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { pointer: e.pointerId, at: isSide ? e.clientX : e.clientY, size: value };
      }}
      onPointerMove={(e) => {
        const active = drag.current;
        if (active?.pointer !== e.pointerId) return;
        onChange(valid(active.size + direction * ((isSide ? e.clientX : e.clientY) - active.at)));
      }}
      onLostPointerCapture={() => {
        drag.current = undefined;
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onReset();
          return;
        }
        const plus = isSide ? 'ArrowRight' : 'ArrowDown',
          minus = isSide ? 'ArrowLeft' : 'ArrowUp';
        if (e.key !== plus && e.key !== minus) return;
        e.preventDefault();
        onChange(valid(value + direction * (e.key === plus ? 1 : -1) * (e.shiftKey ? 32 : 8)));
      }}
    />
  );
}
