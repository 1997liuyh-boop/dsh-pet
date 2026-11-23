import type { StateLeaf } from './state.ts';

export interface GrowthSnapshot {
  level: number;
  xp: number;
  xpToLevel: number;
  animation: string | null;
  until: number;
}

// 升级点播标记与素材名分开，普通工作庆祝不会显示升级提示。
export const LEVEL_UP_ANIMATION = '@growth-level-up';
export const LEVEL_UP_ASSET = '养成-升级庆祝';
export const LEVEL_UP_FALLBACK_ANIMATION = '@growth-level-up-fallback';
export const LEVEL_UP_FALLBACK_ASSET = '工作状态-雀跃庆祝';
export const GROWTH_EVENT = 'growth';

export function isLevelUpAnimation(name: string | null | undefined): boolean {
  return name === LEVEL_UP_ANIMATION || name === LEVEL_UP_FALLBACK_ANIMATION;
}

export function growthAnimationAsset(name: string): string {
  if (name === LEVEL_UP_ANIMATION) return LEVEL_UP_ASSET;
  if (name === LEVEL_UP_FALLBACK_ANIMATION) return LEVEL_UP_FALLBACK_ASSET;
  return name;
}

export const EMPTY_GROWTH: GrowthSnapshot = { level: 0, xp: 0, xpToLevel: 100, animation: null, until: 0 };

export function readGrowth(leaf: StateLeaf): GrowthSnapshot {
  const data = leaf.data as Partial<GrowthSnapshot> | null;
  if (!data || typeof data.level !== 'number' || typeof data.xp !== 'number' || typeof data.xpToLevel !== 'number') {
    return EMPTY_GROWTH;
  }
  return {
    level: Math.max(0, data.level),
    xp: Math.max(0, data.xp),
    xpToLevel: Math.max(1, data.xpToLevel),
    animation: typeof data.animation === 'string' ? data.animation : null,
    until: typeof data.until === 'number' ? data.until : 0,
  };
}

export function growthLoop(growth: GrowthSnapshot | undefined): string | null {
  return growth && growth.until > Date.now() ? growth.animation : null;
}

export function growthPercent(growth: GrowthSnapshot): number {
  return Math.min(100, (growth.xp / growth.xpToLevel) * 100);
}

export const GROWTH_HUD = 'dsh-pet-growth absolute flex items-center pointer-events-none';
export const GROWTH_TRACK = 'dsh-pet-growth-track flex-1 overflow-hidden rounded-full';
export const GROWTH_FILL = 'dsh-pet-growth-fill block h-full rounded-full';

// 两端共用的局部原子样式，避免依赖宿主页的 Tailwind 构建或覆盖宿主样式。
export const GROWTH_CSS = [
  '.dsh-pet-growth.absolute{position:absolute;left:50%;bottom:8%;transform:translateX(-50%);z-index:2}',
  '.dsh-pet-growth.flex{display:flex;gap:.45em;width:clamp(56px,30%,126px);padding:.22em .52em;box-sizing:border-box}',
  '.dsh-pet-growth.items-center{align-items:center}',
  '.dsh-pet-growth.pointer-events-none{pointer-events:none;visibility:hidden}',
  '.dsh-pet-stage:has(>.dsh-pet-hit:hover)>.dsh-pet-growth,.pet-stage:has(>.pet-hit:hover)>.dsh-pet-growth{visibility:visible}',
  '.dsh-pet-growth{border-radius:999px;background:rgba(17,32,54,.9);color:#fff;font:600 clamp(9px,2.7cqi,13px)/1.35 system-ui,sans-serif;white-space:nowrap;font-variant-numeric:tabular-nums}',
  '.dsh-pet-stage,.pet-stage{container-type:inline-size}',
  '.dsh-pet-growth-track.flex-1{flex:1;height:.36em;background:rgba(255,255,255,.26)}',
  '.dsh-pet-growth-track.overflow-hidden{overflow:hidden}',
  '.dsh-pet-growth-fill.block{display:block;background:#78dcff}',
  '.dsh-pet-growth-fill.h-full{height:100%}',
  '.dsh-pet-growth .rounded-full{border-radius:999px}',
  '[data-level-up]>.dsh-pet-bubble,[data-level-up]>.pet-bubble{visibility:hidden}',
  '[data-level-up]>.dsh-pet-stage::after,[data-level-up]>.pet-stage::after{content:"Level Up!";position:absolute;top:8%;left:50%;transform:translateX(-50%);z-index:3;pointer-events:none;white-space:nowrap;color:#fff2a3;font:900 clamp(14px,8cqi,36px)/1.1 system-ui,sans-serif;-webkit-text-stroke:.05em #442216;text-shadow:0 .08em .24em #331b0f}',
].join('');
