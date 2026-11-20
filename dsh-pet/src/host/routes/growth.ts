import { readAllConfig } from '../config.ts';
import type { RouteResult } from '../http.ts';
import { growthFeedbackText, publishGrowthAnimation } from '../growth/feedback.ts';
import { growthCommand, growthView } from '../growth/rules.ts';
import { failResult, invalidJson, methodNotAllowed, okResult } from './result.ts';
import type { RouteHandler } from './types.ts';

export const handleGrowthRoutes: RouteHandler = async (
  deps,
  { url, rest, method, body },
): Promise<RouteResult | undefined> => {
  const isGrowth = rest === 'growth';
  if (!isGrowth) return undefined;
  if (method !== 'POST') return methodNotAllowed();
  let parsed: unknown;
  try {
    parsed = JSON.parse(body ?? 'null');
  } catch {
    return invalidJson();
  }
  const command = growthCommand.safeParse((parsed as { command?: unknown } | null)?.command);
  if (!command.success) return failResult('bad-request', '养成指令无效');

  let refused: RouteResult | null = null;
  try {
    const who = deps.requirePet(url.searchParams, () => readAllConfig(deps.configPaths), { surface: true });
    if (!who.ok) return who.res;
    const gate = () => deps.lockBlocked(who.petId, url.searchParams) ?? deps.sleepBlocked(who.petId, url.searchParams);
    const blocked = gate();
    if (blocked) return blocked;
    const result = await deps.growth.command(who.petId, command.data, () => {
      refused = gate();
      if (refused) throw new Error('养成操作已被拦截');
    });
    if (!gate()) publishGrowthAnimation(deps.state, who.conf, result, result.animation);
    return okResult({
      ok: true,
      growth: growthView(result.next, result.now),
      message: growthFeedbackText(result, result.text, result.now),
    });
  } catch (error) {
    if (refused) return refused;
    deps.log.warn('[dsh-pet] 养成状态读写失败：' + String(error));
    return failResult('growth-unavailable', '暂时无法读取或保存养成进度。');
  }
};
