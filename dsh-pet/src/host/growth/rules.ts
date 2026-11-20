import { z } from 'zod';

const UNIT = 10_000;
const MAX_METER = 100 * UNIT;
export const GROWTH_TICK_MS = 30_000;
export const GROWTH_ROUND_TICKS = 10;
const XP_PER_LEVEL = 100;
const FATIGUE_RESET_MS = 10 * 60_000;
const PLAY_COOLDOWN_MS = 60_000;

const units = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const meter = units.max(MAX_METER);
const activityKind = z.enum(['study', 'work']);
export const growthCommand = z.enum(['status', 'study', 'work', 'play', 'feed', 'stop']);
export type GrowthCommand = z.infer<typeof growthCommand>;

export const petGrowthSchema = z.object({
  xp: units,
  fullness: meter,
  mood: meter,
  effortTicks: units,
  lastEffortAt: units,
  playReadyAt: units,
  activity: z.object({ kind: activityKind, nextAt: units, remaining: units.max(GROWTH_ROUND_TICKS) }).nullable(),
});
export type PetGrowth = z.infer<typeof petGrowthSchema>;

export function initialGrowth(): PetGrowth {
  return {
    xp: 0,
    fullness: MAX_METER,
    mood: MAX_METER,
    effortTicks: 0,
    lastEffortAt: 0,
    playReadyAt: 0,
    activity: null,
  };
}

export function growthLevel(pet: PetGrowth): number {
  return Math.floor(pet.xp / (UNIT * XP_PER_LEVEL));
}

export function growthView(pet: PetGrowth, now: number) {
  const seconds = (at: number): number => Math.ceil(Math.max(0, at - now) / 1000);
  return {
    level: growthLevel(pet),
    xp: Math.floor(pet.xp / UNIT) % XP_PER_LEVEL,
    xpToLevel: XP_PER_LEVEL,
    fullness: Math.ceil(pet.fullness / UNIT),
    mood: Math.ceil(pet.mood / UNIT),
    hungry: pet.fullness <= 20 * UNIT,
    activity: pet.activity?.kind ?? null,
    activitySeconds: pet.activity ? seconds(pet.activity.nextAt + (pet.activity.remaining - 1) * GROWTH_TICK_MS) : 0,
    playCooldownSeconds: seconds(pet.playReadyAt),
  };
}

// 用整数累计不足 1 点的用量和饥饿影响，以免小请求被舍掉。
function earn(pet: PetGrowth, xp: number, cost: number, moodCost = 0): PetGrowth {
  const spent = Math.min(pet.fullness, cost);
  return {
    ...pet,
    xp: Math.min(Number.MAX_SAFE_INTEGER, pet.xp + xp),
    fullness: pet.fullness - spent,
    mood: Math.max(0, pet.mood - Math.floor(spent / 2) - moodCost),
  };
}

export function applyTokenUsage(pet: PetGrowth, tokens: number): PetGrowth {
  const next = earn(pet, tokens, tokens * 2);
  return next.fullness === 0 ? { ...next, activity: null } : next;
}

// 结算已经过完的段落，重启补算也不会超过当初开始的这一轮。
export function advanceGrowth(pet: PetGrowth, now: number): PetGrowth {
  let next = pet;
  while (next.activity && next.activity.nextAt <= now) {
    const { kind, nextAt, remaining } = next.activity;
    const recent = nextAt - next.lastEffortAt <= FATIGUE_RESET_MS;
    const effortTicks = (recent ? next.effortTicks : 0) + 1;
    const working = kind === 'work';
    next = earn(next, (working ? 4 : 3) * UNIT, (working ? 3 : 2) * UNIT, effortTicks > 6 ? UNIT : 0);
    next.effortTicks = effortTicks;
    next.lastEffortAt = nextAt;
    next.activity =
      remaining > 1 && next.fullness > 0 ? { kind, nextAt: nextAt + GROWTH_TICK_MS, remaining: remaining - 1 } : null;
  }
  return next;
}

export const activityLabel = (kind: 'study' | 'work'): string => (kind === 'work' ? '工作' : '学习');

export function growthStatusText(pet: PetGrowth, now: number): string {
  const view = growthView(pet, now);
  const active = view.activity ? `${activityLabel(view.activity)}中 · 剩 ${view.activitySeconds} 秒` : '休息中';
  return `Lv.${view.level} · 经验 ${view.xp}/${view.xpToLevel} · 饱食度 ${view.fullness}/100${view.hungry ? '（饿了）' : ''} · 心情 ${view.mood}/100 · ${active}`;
}

export function applyGrowthCommand(pet: PetGrowth, command: GrowthCommand, now: number) {
  const result = (next: PetGrowth, text: string, animation?: GrowthCommand) => ({ next, text, animation });
  if (command === 'status') return result(pet, '');
  if (command === 'stop') {
    return pet.activity ? result({ ...pet, activity: null }, '活动已结束。') : result(pet, '现在正在休息。');
  }
  if (command === 'feed') {
    return result({ ...pet, fullness: Math.min(MAX_METER, pet.fullness + 30 * UNIT) }, '开饭啦！', command);
  }
  if (pet.activity) return result(pet, `正在${activityLabel(pet.activity.kind)}，可以先结束活动。`);
  if (command === 'play') {
    const seconds = growthView(pet, now).playCooldownSeconds;
    if (seconds > 0) return result(pet, `休息 ${seconds} 秒就能继续玩。`);
    return result(
      { ...pet, mood: Math.min(MAX_METER, pet.mood + 18 * UNIT), playReadyAt: now + PLAY_COOLDOWN_MS },
      '一起玩吧！',
      command,
    );
  }
  if (pet.fullness <= 20 * UNIT) return result(pet, '肚子饿了，先喂点吃的吧。');
  const activity = { kind: command, nextAt: now + GROWTH_TICK_MS, remaining: GROWTH_ROUND_TICKS };
  return result({ ...pet, activity }, `开始${activityLabel(command)}，最多 5 分钟。`, command);
}
