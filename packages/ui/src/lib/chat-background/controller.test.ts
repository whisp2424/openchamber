import { describe, expect, test } from 'bun:test';
import { createBackgroundController } from './controller';

const id = 'a'.repeat(64);
const empty = { version: 2, imageId: null };
const selected = { ...empty, imageId: id };
const json = (value: typeof empty | typeof selected) => Response.json(value);
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((accept) => { resolve = accept; });
  return { promise, resolve };
}
function fixture(request: (path: string, options?: RequestInit) => Promise<Response>) {
  const revoked: string[] = [];
  let created = 0;
  const controller = createBackgroundController({
    request,
    createObjectURL: () => `blob:test-${++created}`,
    revokeObjectURL: (url) => { revoked.push(url); },
  });
  return { controller, revoked, created: () => created };
}

describe('chat background lifecycle', () => {
  test('reuses the image for metadata refreshes and releases it on confirmed removal', async () => {
    let config: typeof empty | typeof selected = selected;
    let images = 0;
    const { controller, revoked, created } = fixture(async (path, options) => {
      if (options?.method === 'DELETE') config = { ...empty, imageId: null };
      if (path.includes('/image/')) { images += 1; return new Response('png'); }
      return json(config);
    });
    await controller.refresh();
    await controller.refresh();
    expect(images).toBe(1);
    expect(created()).toBe(1);
    expect(controller.getSnapshot().imageUrl).toBe('blob:test-1');
    await controller.remove();
    expect(controller.getSnapshot().imageUrl).toBeNull();
    expect(revoked).toEqual(['blob:test-1']);
  });

  test('read, malformed response, and write failures preserve confirmed data', async () => {
    let fail = false;
    const { controller } = fixture(async (path) => {
      if (fail) return new Response('{}', { status: 500 });
      return path.includes('/image/') ? new Response('png') : json(selected);
    });
    await controller.refresh();
    fail = true;
    await controller.refresh();
    expect(controller.getSnapshot().error).toBe('load');
    await controller.remove();
    expect(controller.getSnapshot().error).toBe('save');
    expect(controller.getSnapshot().configuration).toEqual(selected);
    expect(controller.getSnapshot().imageUrl).toBe('blob:test-1');
    const malformed = fixture(async () => Response.json({ version: 2, imageId: 'invalid' }));
    await malformed.controller.refresh();
    expect(malformed.controller.getSnapshot().configuration).toBeNull();
    expect(malformed.controller.getSnapshot().error).toBe('load');
  });

  test('a delayed read cannot resurrect an image after removal', async () => {
    const old = deferred();
    let reads = 0;
    const { controller } = fixture(async (_path, options) => {
      if (options?.method) return json(empty);
      reads += 1;
      return reads === 1 ? old.promise : json(empty);
    });
    const refresh = controller.refresh();
    await controller.remove();
    old.resolve(json(selected));
    await refresh;
    expect(controller.getSnapshot().configuration).toEqual(empty);
    expect(controller.getSnapshot().imageUrl).toBeNull();
  });

  test('runtime reset rejects stale reads and downloads, including switching back', async () => {
    const image = deferred();
    const started = deferred();
    const { controller, created } = fixture(async (path) => {
      if (path.includes('/image/')) {
        started.resolve(new Response());
        return image.promise;
      }
      return json(selected);
    });
    const old = controller.refresh();
    await started.promise;
    controller.reset();
    controller.reset();
    image.resolve(new Response('old png'));
    await old;
    expect(controller.getSnapshot().configuration).toBeNull();
    expect(created()).toBe(0);
  });

  test('a failed image download keeps the confirmed selection and retries the image', async () => {
    let failed = true;
    const { controller } = fixture(async (path) => path.includes('/image/')
      ? new Response('png', { status: failed ? 404 : 200 }) : json(selected));
    await controller.upload(new Blob(['png']));
    expect(controller.getSnapshot().configuration).toEqual(selected);
    expect(controller.getSnapshot().error).toBe('load');
    expect(controller.getSnapshot().imageUrl).toBeNull();
    failed = false;
    await controller.refresh();
    expect(controller.getSnapshot().imageUrl).toBe('blob:test-1');
    expect(controller.getSnapshot().error).toBeNull();
  });

  test('serializes uploads and cancels queued mutations when the runtime changes', async () => {
    const first = deferred();
    const calls: string[] = [];
    const { controller } = fixture(async (path, options) => {
      if (options?.method) calls.push(options.method);
      if (path.includes('/image/')) return new Response('png');
      return calls.length === 1 ? first.promise : json(empty);
    });
    const one = controller.upload(new Blob(['image']));
    const two = controller.remove();
    await Promise.resolve();
    expect(calls).toEqual(['PUT']);
    controller.reset();
    first.resolve(json(selected));
    await Promise.all([one, two]);
    expect(calls).toHaveLength(1);
    expect(controller.getSnapshot().configuration).toBeNull();
    expect(controller.getSnapshot().saving).toBe(false);
  });

  test('successful queued image mutations retain their order', async () => {
    const first = deferred();
    const calls: string[] = [];
    const { controller } = fixture(async (path, options) => {
      if (options?.method) calls.push(options.method);
      if (path.includes('/image/')) return new Response('png');
      return calls.length === 1 ? first.promise : json(empty);
    });
    const one = controller.upload(new Blob(['image']));
    const two = controller.remove();
    await Promise.resolve();
    expect(calls).toHaveLength(1);
    expect(controller.getSnapshot().saving).toBe(true);
    first.resolve(json(selected));
    await Promise.all([one, two]);
    expect(calls).toEqual(['PUT', 'DELETE']);
    expect(controller.getSnapshot().configuration).toEqual(empty);
    expect(controller.getSnapshot().saving).toBe(false);
  });
});
