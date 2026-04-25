import { useEnterTransition } from '../hooks/useEnterTransition';

/**
 * Drop-in replacement for `<div className="fade-in">`. Renders with the
 * resting `.enter` styles on first paint, then toggles `.enter--mounted`
 * on the next frame so the CSS transition runs.
 *
 * Pass an extra `className` to merge with the base `enter` class.
 */
export default function Enter({ as = 'div', className = '', children, ref, ...rest }) {
  const mounted = useEnterTransition();
  const cls = ['enter', mounted && 'enter--mounted', className].filter(Boolean).join(' ');
  const Tag = as;
  return (
    <Tag className={cls} ref={ref} {...rest}>
      {children}
    </Tag>
  );
}
