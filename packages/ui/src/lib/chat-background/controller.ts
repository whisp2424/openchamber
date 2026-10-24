import { z } from 'zod';

const configuration = z.strictObject({
  version: z.literal(2),
  imageId: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
});
type Configuration = z.infer<typeof configuration>;
type BackgroundState = {
  configuration: Configuration | null;
  imageUrl: string | null;
  loading: boolean;
  saving: boolean;
  error: 'load' | 'save' | null;
};
type Dependencies = {
  request: (path: string, options?: RequestInit) => Promise<Response>;
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
};
const emptyState = (): BackgroundState => ({ configuration: null, imageUrl: null, loading: false, saving: false, error: null });
const route = '/api/chat-background';

export function createBackgroundController(dependencies: Dependencies) {
  let state = emptyState();
  let generation = 0;
  let revision = 0;
  let pending = 0;
  let writes = Promise.resolve();
  const listeners = new Set<() => void>();
  const publish = (next: BackgroundState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const accept = async (response: Response, owner: number, requestRevision: number) => {
    if (!response.ok) throw new Error('Background request failed');
    const next = configuration.parse(await response.json());
    if (owner !== generation || requestRevision !== revision) return;
    const needsImage = Boolean(next.imageId) && (next.imageId !== state.configuration?.imageId || !state.imageUrl);
    if (next.imageId !== state.configuration?.imageId && state.imageUrl) {
      dependencies.revokeObjectURL(state.imageUrl);
    }
    publish({
      ...state,
      configuration: next,
      imageUrl: next.imageId === state.configuration?.imageId ? state.imageUrl : null,
      loading: needsImage,
      error: null,
    });
    if (!needsImage) return;
    try {
      const image = await dependencies.request(`${route}/image/${next.imageId}`);
      if (!image.ok) throw new Error('Background image unavailable');
      const blob = await image.blob();
      if (owner !== generation || requestRevision !== revision) return;
      publish({ ...state, imageUrl: dependencies.createObjectURL(blob), loading: false });
    } catch {
      // The manifest is confirmed even when its image cannot be downloaded.
      // Show the theme and allow retry without claiming the save failed.
      if (owner === generation && requestRevision === revision) publish({ ...state, loading: false, error: 'load' });
    }
  };
  const refresh = async () => {
    if (pending) return;
    const owner = generation;
    const requestRevision = ++revision;
    publish({ ...state, loading: true });
    try {
      await accept(await dependencies.request(route), owner, requestRevision);
    } catch {
      if (owner === generation && requestRevision === revision) publish({ ...state, loading: false, error: 'load' });
    }
  };
  const mutate = (options: RequestInit, suffix = '') => {
    const owner = generation;
    ++revision; // A read started before this intent cannot replace its result.
    pending += 1;
    publish({ ...state, saving: true, loading: false, error: null });
    const operation = writes.then(async () => {
      if (owner !== generation) return;
      const requestRevision = ++revision;
      try {
        await accept(await dependencies.request(`${route}${suffix}`, options), owner, requestRevision);
      } catch {
        if (owner === generation) publish({ ...state, error: 'save' });
      } finally {
        if (owner === generation) {
          pending -= 1;
          publish({ ...state, saving: pending > 0 });
        }
      }
    });
    writes = operation;
    return operation;
  };
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    refresh,
    upload: (image: Blob) => mutate({ method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: image }, '/image'),
    remove: () => mutate({ method: 'DELETE' }, '/image'),
    reset: () => {
      generation += 1;
      revision += 1;
      pending = 0;
      writes = Promise.resolve();
      if (state.imageUrl) dependencies.revokeObjectURL(state.imageUrl);
      publish(emptyState());
    },
  };
}
