export const PROFILES = Object.freeze([
  { name: 'Minimum', cvars: { r_picmip: 3, r_subdivisions: 20, r_detailtextures: 0, r_dynamiclight: 0, cg_shadows: 0, r_lodbias: 2, r_fastsky: 1 } },
  { name: 'Performance', cvars: { r_picmip: 2, r_subdivisions: 12, r_detailtextures: 0, r_dynamiclight: 0, cg_shadows: 0, r_lodbias: 1, r_fastsky: 0 } },
  { name: 'Balanced', cvars: { r_picmip: 1, r_subdivisions: 8, r_detailtextures: 1, r_dynamiclight: 1, cg_shadows: 1, r_lodbias: 0, r_fastsky: 0 } },
  { name: 'Maximum', cvars: { r_picmip: 0, r_subdivisions: 4, r_detailtextures: 1, r_dynamiclight: 1, cg_shadows: 2, r_lodbias: -2, r_fastsky: 0 } }
]);

export function profileTokens(index) {
  return Object.entries(PROFILES[index].cvars).flatMap(([name, value]) => ['+set', name, String(value)]);
}

export function createAdaptiveQuality(options) {
  let level = options.ceiling;
  let slow = 0;
  let fast = 0;
  function sample(fps) {
    if (!options.enabled || document.hidden) return level;
    if (fps < options.target * 0.92) { slow += 1; fast = 0; }
    else if (fps >= options.target * 0.985) { fast += 1; slow = 0; }
    else { slow = 0; fast = 0; }
    let next = level;
    if (slow >= 2 && level > 0) next -= 1;
    if (fast >= 5 && level < options.ceiling) next += 1;
    if (next !== level) {
      level = next; slow = 0; fast = 0; options.onChange?.(level, PROFILES[level]);
    }
    return level;
  }
  return { sample, current: () => level, counters: () => ({ slow, fast }) };
}
