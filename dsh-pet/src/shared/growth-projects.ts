import type { Animations } from './types.ts';

export const GROWTH_PROJECTS = {
  work: [
    { id: 'copywriting', label: '写文案', animation: '养成-写文案', fallback: '轻快记录' },
    { id: 'video-editing', label: '剪视频', animation: '养成-剪视频', fallback: '工作状态-忙碌点按' },
    { id: 'coding', label: '敲代码', animation: '写代码' },
    { id: 'carry-token', label: '搬 Token', animation: '养成-搬 Token', fallback: '工作状态-清点归档' },
  ],
  study: [
    { id: 'drawing', label: '学画画', animation: '养成-学画画', fallback: '轻快记录' },
    { id: 'calligraphy', label: '学书法', animation: '写福字' },
    { id: 'singing', label: '学唱歌', animation: '悠闲哼歌' },
    { id: 'mixology', label: '学调酒', animation: '养成-学调酒', fallback: '工作状态-思考冒泡' },
  ],
} as const;

export const PLAY_CATEGORY = '玩耍';
export const FOOD_CATEGORY = '吃什么';
const SEASONAL_CATEGORY = '时节';
const SEASONAL_FOOD = new Set(['吃粽子', '吃年糕', '吃青团', '吃腊八粥', '吃重阳糕', '吃汤圆', '吃饺子']);

export function isGrowthFood(category: string, name: string): boolean {
  return category === FOOD_CATEGORY || (category === SEASONAL_CATEGORY && SEASONAL_FOOD.has(name));
}

export function growthFeedActions(animations?: Pick<Animations, 'categories'>): string[] {
  return categoryActions(animations, isGrowthFood);
}

export function growthPlayActions(animations?: Pick<Animations, 'categories'>): string[] {
  return categoryActions(animations, (category) => category === PLAY_CATEGORY);
}

function categoryActions(
  animations: Pick<Animations, 'categories'> | undefined,
  includes: (category: string, name: string) => boolean,
): string[] {
  const categories = animations?.categories;
  if (!Array.isArray(categories)) return [];
  const actions = categories.flatMap((category) => {
    if (!category || !Array.isArray(category.actions)) return [];
    return category.actions.filter((name) => typeof name === 'string' && name.trim() && includes(category.id, name));
  });
  return [...new Set(actions)];
}

export function growthProject(kind: string, id: string) {
  if (kind !== 'work' && kind !== 'study') return undefined;
  return GROWTH_PROJECTS[kind].find((item) => item.id === id);
}
