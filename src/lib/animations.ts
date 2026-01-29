/**
 * Shared Framer Motion animation constants for consistent animations across the app
 */

// Transition presets
export const transitions = {
  // Spring animation for interactive elements (buttons, cards)
  spring: { type: 'spring' as const, stiffness: 400, damping: 25 },

  // Bouncy spring for playful interactions
  bounce: { type: 'spring' as const, stiffness: 500, damping: 15 },

  // Smooth easing for general transitions
  smooth: { duration: 0.2, ease: 'easeOut' as const },

  // Slower smooth for larger elements
  smoothSlow: { duration: 0.3, ease: 'easeOut' as const },

  // Quick snap for instant feedback
  snap: { duration: 0.15, ease: 'easeInOut' as const },
}

// Animation variants for common patterns
export const variants = {
  // Simple fade in/out
  fadeIn: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
  },

  // Slide up with fade
  slideUp: {
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -10 },
  },

  // Slide down with fade
  slideDown: {
    initial: { opacity: 0, y: -20 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: 10 },
  },

  // Scale with fade
  scale: {
    initial: { opacity: 0, scale: 0.95 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.95 },
  },

  // Scale from smaller
  scaleUp: {
    initial: { opacity: 0, scale: 0.8 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.8 },
  },

  // Slide in from left
  slideInLeft: {
    initial: { opacity: 0, x: -20 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: 20 },
  },

  // Slide in from right
  slideInRight: {
    initial: { opacity: 0, x: 20 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -20 },
  },
}

// Stagger children animations
export const staggerContainer = {
  animate: {
    transition: {
      staggerChildren: 0.05,
    },
  },
}

export const staggerContainerSlow = {
  animate: {
    transition: {
      staggerChildren: 0.1,
    },
  },
}

// Hover effects
export const hoverScale = {
  whileHover: { scale: 1.02 },
  whileTap: { scale: 0.98 },
}

export const hoverScaleSmall = {
  whileHover: { scale: 1.01 },
  whileTap: { scale: 0.99 },
}

export const hoverLift = {
  whileHover: {
    scale: 1.02,
    y: -2,
    boxShadow: '0 10px 30px rgba(0,0,0,0.12)',
  },
  whileTap: { scale: 0.98 },
}

// Page transition
export const pageTransition = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.2 },
}

// List item animation (for use with AnimatePresence)
export const listItem = {
  initial: { opacity: 0, height: 0 },
  animate: { opacity: 1, height: 'auto' },
  exit: { opacity: 0, height: 0 },
  transition: transitions.spring,
}

// Menu item grid animation
export const menuItemAnimation = (index: number) => ({
  initial: { opacity: 0, scale: 0.9 },
  animate: {
    opacity: 1,
    scale: 1,
    transition: { delay: index * 0.02, ...transitions.spring },
  },
})

// Order item animation
export const orderItemAnimation = {
  initial: { opacity: 0, x: -20, height: 0 },
  animate: { opacity: 1, x: 0, height: 'auto' },
  exit: { opacity: 0, x: 20, height: 0 },
  transition: transitions.spring,
}
