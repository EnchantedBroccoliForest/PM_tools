import { useEffect, useState } from 'react';

/**
 * Toggles a boolean from false to true on the next animation frame after mount.
 * Pair with CSS that sets the resting state on the base class and the active
 * state on the modifier class so transitions retarget cleanly when re-mounted.
 */
export function useEnterTransition() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return mounted;
}
