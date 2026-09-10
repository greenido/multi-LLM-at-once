import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

/**
 * A textarea that grows with what is typed into it, up to `maxHeight`, and
 * scrolls past that. An <input> flattens a pasted snippet onto one line, which
 * is no way to ask several models about code.
 */
export default function GrowingTextarea({ value, maxHeight = 240, className = '', ...props }) {
  const ref = useRef(null);

  // Collapse, then measure: scrollHeight only reports the content's height once
  // the box is no taller than it. The borders are added back because the box
  // is border-box and scrollHeight does not count them.
  const fit = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = 'auto';
    const wanted = element.scrollHeight + element.offsetHeight - element.clientHeight;
    element.style.height = `${Math.min(wanted, maxHeight)}px`;
    // A scrollbar only when there is something to scroll to.
    element.style.overflowY = wanted > maxHeight ? 'auto' : 'hidden';
  }, [maxHeight]);

  // Every edit can change how many lines there are.
  useLayoutEffect(fit, [fit, value]);

  // So can the width. It is not final at first render — the stylesheet can land
  // after it, while the box is still narrow and the placeholder wraps onto
  // many lines — and a window resize re-wraps everything. Height changes are
  // ignored, since fitting is what causes them.
  useEffect(() => {
    const element = ref.current;
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === width) return;
      width = element.clientWidth;
      fit();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [fit]);

  return (
    <textarea ref={ref} rows={1} value={value} className={`resize-none ${className}`} {...props} />
  );
}
