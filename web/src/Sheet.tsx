import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, type PointerEvent, type ReactNode } from 'react';
import { copy } from './copy';

export type SheetHandle = { dismiss: () => void };

const FLICK = 0.11; // px per ms: a quick flick closes the sheet however short the drag
const CLOSE_SHARE = 0.3; // or a drag past this share of the sheet's height
const EXIT = 'transform 200ms cubic-bezier(0.23, 1, 0.32, 1)';
const SNAP = 'transform 320ms cubic-bezier(0.32, 0.72, 0, 1)';

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// The phone's apartment sheet over the map. It slides up when it opens (CSS), follows a downward drag, and closes on a
// long enough drag or a quick flick; closing any other way slides it out too. onClose runs once it is out of sight.
export const Sheet = forwardRef<SheetHandle, { id: string; onClose: () => void; closeRef: React.Ref<HTMLButtonElement>; children: ReactNode }>(function Sheet(
  { id, onClose, closeRef, children },
  handle,
) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; t: number; dy: number; id: number } | null>(null);
  const closing = useRef(false);
  const timer = useRef(0);

  // Another apartment opened while this one was sliding out: cancel the close and bring the sheet back.
  useLayoutEffect(() => {
    if (!closing.current) return;
    closing.current = false;
    clearTimeout(timer.current);
    const el = box.current;
    if (el) {
      el.style.transition = SNAP;
      el.style.transform = 'translateY(0)';
    }
  }, [id]);

  const dismiss = () => {
    const el = box.current;
    if (!el || closing.current) return;
    closing.current = true;
    if (reduced()) return onClose();
    el.style.transition = EXIT;
    el.style.transform = 'translateY(100%)';
    // transitionend can be skipped (e.g. the tab is hidden), so a timer backs it up; whichever comes first closes it, once.
    const done = () => {
      el.removeEventListener('transitionend', done);
      clearTimeout(timer.current);
      if (closing.current) onClose();
    };
    el.addEventListener('transitionend', done, { once: true });
    timer.current = window.setTimeout(done, 260);
  };
  useImperativeHandle(handle, () => ({ dismiss }));

  const down = (e: PointerEvent<HTMLDivElement>) => {
    // Links and buttons keep their taps; one finger at a time.
    if (drag.current || (e.target as HTMLElement).closest('a, button')) return;
    drag.current = { y: e.clientY, t: performance.now(), dy: 0, id: e.pointerId };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.style.transition = 'none';
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    const raw = e.clientY - d.y;
    // Upward the sheet barely gives (friction), downward it follows the finger.
    d.dy = raw < 0 ? -Math.sqrt(-raw) * 2 : raw;
    e.currentTarget.style.transform = `translateY(${d.dy}px)`;
  };
  const up = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    drag.current = null;
    const el = e.currentTarget;
    const velocity = d.dy / Math.max(1, performance.now() - d.t);
    if (d.dy > el.offsetHeight * CLOSE_SHARE || (d.dy > 8 && velocity > FLICK)) return dismiss();
    el.style.transition = SNAP;
    el.style.transform = 'translateY(0)';
  };

  return (
    <div ref={box} className="sheet" role="dialog" aria-label={copy.listLabel} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <span className="sheet-handle" aria-hidden="true" />
      <button ref={closeRef} type="button" className="sheet-close" aria-label={copy.close} onClick={dismiss}>
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
      </button>
      {children}
    </div>
  );
});
