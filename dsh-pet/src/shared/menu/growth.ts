import type { MenuLeaf } from './types.ts';

/** 只让操作的一端显示即时回执，自动升级由宿主另行推送。 */
export async function requestGrowth(
  url: string,
  command: MenuLeaf['growthCommand'],
  project?: string,
): Promise<string> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ command, project }),
    });
    const data = (await response.json()) as { message?: unknown } | null;
    if (typeof data?.message === 'string' && data.message) return data.message;
  } catch {
    // 请求失败也给当前点击端一个明确反馈。
  }
  return '暂时无法操作养成状态。';
}
