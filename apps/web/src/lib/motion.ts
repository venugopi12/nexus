/**
 * Central animation system. Every Motion value in the app comes from here so timing stays
 * consistent and can be tuned (or disabled via prefers-reduced-motion through <MotionConfig>) in one place.
 */
import type { Transition, Variants } from 'motion/react';

export const duration = { instant: 0.08, fast: 0.14, base: 0.2, slow: 0.32 } as const;
export const ease = {
  out: [0.16, 1, 0.3, 1] as const,
  inOut: [0.65, 0, 0.35, 1] as const,
};
export const spring = {
  snappy: { type: 'spring', stiffness: 520, damping: 38, mass: 0.8 } as Transition,
  soft: { type: 'spring', stiffness: 260, damping: 30 } as Transition,
  indicator: { type: 'spring', stiffness: 500, damping: 40 } as Transition,
};
export const tween = {
  fast: { duration: duration.fast, ease: ease.out } as Transition,
  base: { duration: duration.base, ease: ease.out } as Transition,
};

/** Page-level staggered entrance: parent orchestrates, children use `item`. */
export const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.045, delayChildren: 0.02 } },
};
export const item: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: tween.base },
};

export const pageTransition = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: { duration: duration.base, ease: ease.out } },
  exit: { opacity: 0, transition: { duration: duration.instant } },
};

export const overlay: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: duration.fast } },
  exit: { opacity: 0, transition: { duration: duration.fast } },
};
export const dialog: Variants = {
  hidden: { opacity: 0, scale: 0.97, y: 8 },
  show: { opacity: 1, scale: 1, y: 0, transition: { duration: duration.base, ease: ease.out } },
  exit: { opacity: 0, scale: 0.98, y: 4, transition: { duration: duration.fast } },
};
export const drawerRight: Variants = {
  hidden: { x: '100%' },
  show: { x: 0, transition: { type: 'spring', stiffness: 380, damping: 40 } },
  exit: { x: '100%', transition: { duration: duration.fast, ease: ease.inOut } },
};
export const drawerLeft: Variants = {
  hidden: { x: '-100%' },
  show: { x: 0, transition: { type: 'spring', stiffness: 380, damping: 40 } },
  exit: { x: '-100%', transition: { duration: duration.fast, ease: ease.inOut } },
};
export const popover: Variants = {
  hidden: { opacity: 0, scale: 0.96, y: -4 },
  show: { opacity: 1, scale: 1, y: 0, transition: tween.fast },
  exit: { opacity: 0, scale: 0.97, transition: { duration: duration.instant } },
};
export const toast: Variants = {
  hidden: { opacity: 0, x: 24, scale: 0.96 },
  show: { opacity: 1, x: 0, scale: 1, transition: spring.snappy },
  exit: { opacity: 0, x: 24, scale: 0.96, transition: { duration: duration.fast } },
};
export const listItem: Variants = {
  hidden: { opacity: 0, height: 0 },
  show: { opacity: 1, height: 'auto', transition: tween.base },
  exit: { opacity: 0, height: 0, transition: { duration: duration.fast } },
};

export const press = { whileTap: { scale: 0.97 }, transition: spring.snappy };
export const hoverLift = { whileHover: { y: -1 }, transition: spring.snappy };
