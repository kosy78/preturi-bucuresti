import { useLayoutEffect, useRef } from 'react';

// A shape that slides under the pressed button of a group (tab underline, segmented-control thumb), so a change of
// choice reads as movement from the old one to the new one. It follows the group's size, and its first placement
// does not animate.
export function Indicator({ active, className }: { active: string; className: string }) {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    const group = el?.parentElement;
    if (!el || !group) return;
    const place = () => {
      const on = group.querySelector<HTMLElement>('[aria-pressed="true"]');
      el.style.opacity = on ? '1' : '0';
      if (!on) return;
      el.style.width = `${on.offsetWidth}px`;
      el.style.transform = `translateX(${on.offsetLeft}px)`;
    };
    place();
    const ready = requestAnimationFrame(() => el.classList.add('ready'));
    const ro = new ResizeObserver(place);
    ro.observe(group);
    return () => {
      cancelAnimationFrame(ready);
      ro.disconnect();
    };
  }, [active]);

  return <span ref={ref} className={className} aria-hidden="true" />;
}
