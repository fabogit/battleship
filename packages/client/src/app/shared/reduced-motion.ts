import { DestroyRef, InjectionToken, inject, signal, type Signal } from '@angular/core';

/** The media query of the player's "reduce motion" setting. */
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Whether the player asked their system to reduce motion (`prefers-reduced-motion`), followed as the setting changes.
 * Views that move things from code, such as the dice roll (ADR-0107), show a still result instead; CSS animations
 * check the media query themselves. `false` where the browser cannot tell (no `matchMedia`, as in the unit tests),
 * which specs override with a signal of their own.
 */
export const PREFERS_REDUCED_MOTION = new InjectionToken<Signal<boolean>>('PREFERS_REDUCED_MOTION', {
  providedIn: 'root',
  factory: () => {
    const query = typeof matchMedia === 'function' ? matchMedia(REDUCED_MOTION_QUERY) : null;
    const isReduced = signal(query?.matches ?? false);
    const follow = (event: MediaQueryListEvent): void => {
      isReduced.set(event.matches);
    };
    query?.addEventListener('change', follow);
    inject(DestroyRef).onDestroy(() => query?.removeEventListener('change', follow));
    return isReduced.asReadonly();
  },
});
