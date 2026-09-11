// Level scaling, ported from the mod.
//
// LevelScalingConfig.getMultiFor is linear:
//     base_scaling + per_level_scaling * (lvl - 1)
// clamped to [1, MAX_LEVEL] when the curve says cap_to_max_lvl. The
// coefficients are datapack values, so they ship in balance.json rather than
// being hardcoded here - the pack is free to retune them.
//
// Stat.scale then applies that multiplier only for FLAT modifiers; PERCENT and
// MORE are level-independent. Getting that condition wrong is the difference
// between "+20% Armor" and "+416% Armor" at level 100.

export const MIN_LEVEL = 1;

/** LevelScalingConfig.getMultiFor */
export function curveMulti(curve, lvl, maxLevel) {
  if (!curve) return 1;
  let level = lvl;
  if (curve.cap) level = Math.min(Math.max(level, MIN_LEVEL), maxLevel);
  return curve.base + curve.perLevel * (level - 1);
}

export class Scaling {
  constructor(balance) {
    this.curves = balance?.curves || {};
    this.maxLevel = balance?.maxLevel || 100;
    this.stats = balance?.stats || {};
  }

  statMeta(statId) {
    return this.stats[statId] || null;
  }

  /** StatScaling.scale for a named curve. */
  multiFor(scalingName, lvl) {
    if (!scalingName || scalingName === "NONE") return 1;
    return curveMulti(this.curves[scalingName], lvl, this.maxLevel);
  }

  /**
   * Stat.scale(ModType, value, lvl) - flat mods scale, the rest do not.
   */
  scale(statId, modType, value, lvl) {
    if (String(modType).toUpperCase() !== "FLAT") return value;
    const meta = this.statMeta(statId);
    return value * this.multiFor(meta?.scaling, lvl);
  }

  /** ValueCalculation base damage: a LeveledValue, then the calc's curve. */
  calcBase(calc, lvl) {
    if (!calc) return 0;
    const { baseMin = 0, baseMax = 0 } = calc;
    let base = baseMin;
    if (baseMin !== baseMax) {
      // LeveledValue.getValue: min + ((max-min)/maxLevel) * level
      base = baseMin + ((baseMax - baseMin) / this.maxLevel) * lvl;
    }
    return base * this.multiFor(calc.scaling, lvl);
  }
}
