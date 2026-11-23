import { growthFeedActions, growthPlayActions, growthProject } from '../../shared/growth-projects.ts';
import type { Animations } from '../../shared/types.ts';
import { readAllConfig } from '../config.ts';
import type { RouteResult } from '../http.ts';
import { growthFeedbackText, publishGrowthAnimation, publishGrowthState } from '../growth/feedback.ts';
import { growthCommand, growthView } from '../growth/rules.ts';
import { failResult, invalidJson, methodNotAllowed, okResult } from './result.ts';
import type { RouteHandler } from './types.ts';

function activityProjectAllowed(command: string, project: string, animations?: Animations): boolean {
  if (command === 'feed') return growthFeedActions(animations).includes(project);
  if (command === 'play') return growthPlayActions(animations).includes(project);
  return growthProject(command, project) !== undefined;
}

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
  const input = parsed as { command?: unknown; project?: unknown } | null;
  const command = growthCommand.safeParse(input?.command);
  const project = input?.project;
  if (!command.success) return failResult('bad-request', '养成指令无效');
  if (project !== undefined && typeof project !== 'string') return failResult('bad-request', '养成项目无效');

  let refused: RouteResult | null = null;
  try {
    const who = deps.requirePet(url.searchParams, () => readAllConfig(deps.configPaths), { surface: true });
    if (!who.ok) return who.res;
    const gate = () => deps.lockBlocked(who.petId, url.searchParams) ?? deps.sleepBlocked(who.petId, url.searchParams);
    const blocked = gate();
    if (blocked) return blocked;
    if (project !== undefined) {
      const animations = who.conf.animations as Animations | undefined;
      const allowed = activityProjectAllowed(command.data, project, animations);
      if (!allowed) return failResult('bad-request', '该宠物没有这个养成项目');
    }
    const result = await deps.growth.command(
      who.petId,
      command.data,
      () => {
        refused = gate();
        if (refused) throw new Error('养成操作已被拦截');
      },
      project,
    );
    publishGrowthState(deps.state, who.conf, result);
    if (!gate()) publishGrowthAnimation(deps.state, who.conf, result, result.animation, project);
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
