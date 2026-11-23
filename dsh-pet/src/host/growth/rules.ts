import { z } from 'zod';
import { growthProject } from '../../shared/growth-projects.ts';

const UNIT = 10_000;
const MAX_METER = 100 * UNIT;
export const GROWTH_TICK_MS = 30_000;
export const GROWTH_ROUND_TICKS = 10;
const FIRST_LEVEL_XP = 100;
const LEVEL_XP_STEP = 50;
const TOKENS_PER_XP_UNIT = 10;
// 经验使用安全整数。上限高于旧版存档能达到的最大等级。
const MAX_LEVEL = 10_000_000_000;
const xpForLevel = (level: number): number => FIRST_LEVEL_XP + level * LEVEL_XP_STEP;
const FATIGUE_RESET_MS = 10 * 60_000;
export const PLAY_DURATION_MS = 18_000;
const PLAY_COOLDOWN_MS = 60_000;

const units = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const meter = units.max(MAX_METER);
const activityKind = z.enum(['study', 'work', 'play']);
export const growthCommand = z.enum(['status', 'study', 'work', 'play', 'feed', 'stop']);
export type GrowthCommand = z.infer<typeof growthCommand>;

export const petGrowthSchema = z
  .object({
    xp: units,
    level: units.max(MAX_LEVEL).optional(),
    tokenRemainder: units.max(TOKENS_PER_XP_UNIT - 1).default(0),
    fullness: meter,
    mood: meter,
    effortTicks: units,
    lastEffortAt: units,
    playReadyAt: units,
    activity: z
      .object({
        kind: activityKind,
        project: z.string().optional(),
        nextAt: units,
        remaining: units.max(GROWTH_ROUND_TICKS),
      })
      .nullable(),
  })
  .transform((pet) => {
    if (pet.level !== undefined) return { ...pet, level: pet.level };
    // 旧存档保存累计经验，转换后保留原等级与当前等级的进度比例。
    const oldThreshold = FIRST_LEVEL_XP * UNIT;
    const level = Math.floor(pet.xp / oldThreshold);
    const progress = pet.xp % oldThreshold;
    const xp = Math.floor((progress * (level + 2)) / 2);
    return { ...pet, level, xp };
  })
  .refine((pet) => pet.xp < xpForLevel(pet.level) * UNIT, { path: ['xp'] });
export type PetGrowth = z.infer<typeof petGrowthSchema>;

export function initialGrowth(): PetGrowth {
  return {
    xp: 0,
    level: 0,
    tokenRemainder: 0,
    fullness: MAX_METER,
    mood: MAX_METER,
    effortTicks: 0,
    lastEffortAt: 0,
    playReadyAt: 0,
    activity: null,
  };
}

export function growthLevel(pet: PetGrowth): number {
  return pet.level;
}

export function activityEnd(pet: PetGrowth): number {
  const activity = pet.activity;
  return activity ? activity.nextAt + (activity.remaining - 1) * GROWTH_TICK_MS : 0;
}

export function growthView(pet: PetGrowth, now: number) {
  const seconds = (at: number): number => Math.ceil(Math.max(0, at - now) / 1000);
  return {
    level: growthLevel(pet),
    xp: Math.floor(pet.xp / UNIT),
    xpToLevel: xpForLevel(pet.level),
    fullness: Math.ceil(pet.fullness / UNIT),
    mood: Math.ceil(pet.mood / UNIT),
    hungry: pet.fullness <= 20 * UNIT,
    activity: pet.activity?.kind ?? null,
    ...(pet.activity?.project ? { project: pet.activity.project } : {}),
    activitySeconds: seconds(activityEnd(pet)),
    playCooldownSeconds: seconds(pet.playReadyAt),
  };
}

// 用整数累计不足 1 点的用量和饥饿影响，以免小请求被舍掉。
function earn(pet: PetGrowth, xp: number, cost: number, moodCost = 0): PetGrowth {
  const spent = Math.min(pet.fullness, cost);
  let level = pet.level;
  let progress = pet.xp + xp;
  let threshold = xpForLevel(level) * UNIT;
  while (progress >= threshold && level < MAX_LEVEL) {
    progress -= threshold;
    level += 1;
    threshold = xpForLevel(level) * UNIT;
  }
  return {
    ...pet,
    level,
    xp: Math.min(progress, threshold - 1),
    fullness: pet.fullness - spent,
    mood: Math.max(0, pet.mood - Math.floor(spent / 2) - moodCost),
  };
}

export function applyTokenUsage(pet: PetGrowth, tokens: number): PetGrowth {
  const remainder = pet.tokenRemainder + (tokens % TOKENS_PER_XP_UNIT);
  const xp = Math.floor(tokens / TOKENS_PER_XP_UNIT) + Math.floor(remainder / TOKENS_PER_XP_UNIT);
  const next = earn({ ...pet, tokenRemainder: remainder % TOKENS_PER_XP_UNIT }, xp, tokens * 2);
  return next.fullness === 0 && next.activity?.kind !== 'play' ? { ...next, activity: null } : next;
}

// 结算已经过完的段落，重启补算也不会超过当初开始的这一轮。
export function advanceGrowth(pet: PetGrowth, now: number): PetGrowth {
  let next = pet;
  while (next.activity && next.activity.nextAt <= now) {
    const activity = next.activity;
    const { kind, nextAt, remaining } = activity;
    if (kind === 'play') return { ...next, activity: null };
    const recent = nextAt - next.lastEffortAt <= FATIGUE_RESET_MS;
    const effortTicks = (recent ? next.effortTicks : 0) + 1;
    const working = kind === 'work';
    next = earn(next, (working ? 4 : 3) * UNIT, (working ? 3 : 2) * UNIT, effortTicks > 6 ? UNIT : 0);
    next.effortTicks = effortTicks;
    next.lastEffortAt = nextAt;
    next.activity =
      remaining > 1 && next.fullness > 0
        ? { ...activity, nextAt: nextAt + GROWTH_TICK_MS, remaining: remaining - 1 }
        : null;
  }
  return next;
}

export const activityLabel = (kind: 'study' | 'work' | 'play'): string =>
  ({ study: '学习', work: '工作', play: '玩耍' })[kind];

export function growthStatusText(pet: PetGrowth, now: number): string {
  const view = growthView(pet, now);
  const label = pet.activity ? currentActivityLabel(pet.activity) : '';
  const active = label ? `${label}中 · 剩 ${view.activitySeconds} 秒` : '休息中';
  return [
    `Lv.${view.level} · 经验 ${view.xp}/${view.xpToLevel}`,
    `饱食度 ${view.fullness}/100${view.hungry ? '（饿了）' : ''}`,
    `心情 ${view.mood}/100`,
    active,
  ].join('\n');
}

function currentActivityLabel(activity: NonNullable<PetGrowth['activity']>): string {
  const { kind, project } = activity;
  if (!project) return activityLabel(kind);
  return kind === 'play' ? project : (growthProject(kind, project)?.label ?? activityLabel(kind));
}

export function applyGrowthCommand(pet: PetGrowth, command: GrowthCommand, now: number, project?: string) {
  const result = (next: PetGrowth, text: string, animation?: GrowthCommand) => ({ next, text, animation });
  if (command === 'status') return result(pet, '');
  if (command === 'stop') {
    return pet.activity ? result({ ...pet, activity: null }, '活动已结束。') : result(pet, '现在正在休息。');
  }
  if (command === 'feed') {
    return result(
      { ...pet, fullness: Math.min(MAX_METER, pet.fullness + 30 * UNIT) },
      project ? `${project}啦！` : '开饭啦！',
      command,
    );
  }
  if (pet.activity) {
    if (pet.activity.kind === 'work' && command === 'work' && project && project !== pet.activity.project) {
      const activity = { ...pet.activity, project };
      return result({ ...pet, activity }, `已切换到${currentActivityLabel(activity)}。`, command);
    }
    return result(pet, `正在${currentActivityLabel(pet.activity)}，可以先结束活动。`);
  }
  if (command === 'play') {
    const seconds = growthView(pet, now).playCooldownSeconds;
    if (seconds > 0) return result(pet, `休息 ${seconds} 秒就能继续玩。`);
    return result(
      {
        ...pet,
        mood: Math.min(MAX_METER, pet.mood + 18 * UNIT),
        playReadyAt: now + PLAY_COOLDOWN_MS,
        activity: { kind: 'play', ...(project ? { project } : {}), nextAt: now + PLAY_DURATION_MS, remaining: 1 },
      },
      project ? `开始${project}！` : '一起玩吧！',
      command,
    );
  }
  if (pet.fullness <= 20 * UNIT) return result(pet, '肚子饿了，先喂点吃的吧。');
  const activity = {
    kind: command,
    ...(project ? { project } : {}),
    nextAt: now + GROWTH_TICK_MS,
    remaining: GROWTH_ROUND_TICKS,
  };
  return result({ ...pet, activity }, `开始${currentActivityLabel(activity)}，最多 5 分钟。`, command);
}
