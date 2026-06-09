import { getHandlers } from './loader';

export async function invokePluginHandler(id: string, name: string, args: unknown[]): Promise<unknown> {
  const fn = getHandlers().get(`${id}:${name}`);
  if (!fn) throw new Error(`no handler: ${id}:${name}`);
  return await fn(...args);
}
