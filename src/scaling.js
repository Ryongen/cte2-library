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
//
// A skill carries a *second* level beside the character's, and the two are not
// interchangeable - see `SkillLevel` at the bottom.

export const MIN_LEVEL = 1;

/** LevelScalingConfig.getMultiFor */
export function curveMulti(curve, lvl, maxLevel) {
  if (!curve) return 1;
  let level = lvl;
  if (curve.cap) level = Math.min(Math.max(level, MIN_LEVEL), maxLevel);
  return curve.base + curve.perLevel * (level - 1);
}

/**
 * LeveledValue.getValue - a value that walks from min to max across a level
 * range. Note the asymmetry with a stat range: `max` is reached at `maxLvl`,
 * and `min` is the value at level *zero*, not at level one.
 */
export function leveledValue(min, max, lvl, maxLvl) {
  if (min === max || !maxLvl) return min;
  return min + ((max - min) / maxLvl) * lvl;
}

export class Scaling {
  constructor(balance) {
    this.curves = balance?.curves || {};
    this.maxLevel = balance?.maxLevel || 100;
    this.stats = balance?.stats || {};
    // GameBalanceConfig.MAX_BONUS_SPELL_LEVELS - how far past its natural max
    // gear can push a skill gem's rank
    this.maxBonusSpellLevels = balance?.maxBonusSpellLevels ?? 0;
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

  /**
   * ValueCalculation base damage: a LeveledValue, then the calc's curve.
   *
   * The two halves read different levels, and mixing them up is a silent
   * factor-of-twenty error. `base.getValue(en, provider)` is handed the *Spell*
   * as its MaxLevelProvider, so the min -> max walk is over the gem's rank;
   * `base_scaling_type.scale(..., Load.Unit(en).getLevel())` is the caster's.
   */
  calcBase(calc, lvl, skill) {
    if (!calc) return 0;
    const { baseMin = 0, baseMax = 0 } = calc;
    const base = leveledValue(baseMin, baseMax, skill.lvl, skill.maxLvl);
    return base * this.multiFor(calc.scaling, lvl);
  }

  /**
   * GameBalanceConfig.MANA_COST_SCALING, read at the *caster's* level.
   *
   * SpellStatsCalculationEvent multiplies both resource costs by this before
   * anything else touches them, so a level 100 character pays 20.8x the
   * configured number. Only the min -> max walk inside the cost belongs to the
   * skill's own level.
   */
  manaCostMulti(lvl) {
    return this.multiFor("MANA_COST", lvl);
  }
}

/**
 * A skill gem's own rank, which is not the character's level.
 *
 * `max_lvl` is what the gem reaches on its own; gear can add up to
 * MAX_BONUS_SPELL_LEVELS more (8 in this pack, 5 in the bare mod) and nothing
 * else can, so `maxLvl` here is Spell.getMaxLevelWithBonuses. Rank 0 is a real
 * state - an unlearned skill - and `default_lvl` is the floor Spell.getLevelOf
 * clamps up to, which is how a mercenary's skill has a rank with no player
 * behind it.
 *
 * `pct` is the roll percent every per-rank number is read at: the rank against
 * the ceiling *with* bonuses, truncated to an int exactly as Spell.getStats
 * does, so a gem at its natural 20 of 28 shows 71% of its range and not 100%.
 */
export class SkillLevel {
  constructor(row, scaling, want = null) {
    this.natural = row?.f?.maxLvl ?? 20;
    this.maxLvl = this.natural + scaling.maxBonusSpellLevels;
    this.floor = row?.f?.defaultLvl ?? 0;
    // the level box holds one wish for every skill; each caps it at its own
    // ceiling rather than the box being re-ranged on each click
    const asked = want == null ? this.natural : want;
    this.lvl = Math.max(this.floor, Math.min(Math.max(asked, 0), this.maxLvl));
    this.pct = Math.trunc((this.lvl / this.maxLvl) * 100);
  }
}
