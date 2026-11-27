/** Demo mode is explicit in development: --mode demo or VITE_BHMS_DEMO_MODE=true. */
export function demoModeEnabled(): boolean {
  return !import.meta.env.PROD && (import.meta.env.MODE === 'demo' || import.meta.env.VITE_BHMS_DEMO_MODE === 'true')
}

/** Tests retain legacy fixture controls; production never exposes demo navigation. */
export function demoControlsVisible(): boolean {
  return !import.meta.env.PROD && (demoModeEnabled() || import.meta.env.MODE === 'test')
}
