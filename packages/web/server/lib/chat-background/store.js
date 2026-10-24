import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const imageId = z.string().regex(/^[a-f0-9]{64}$/);
const currentDocument = z.strictObject({ version: z.literal(2), imageId: imageId.nullable() });
const legacyDocument = z.strictObject({
  version: z.literal(1),
  imageId: imageId.nullable(),
  dimming: z.number().int().min(0).max(100),
  blur: z.number().int().min(0).max(24),
});
const documentSchema = z.discriminatedUnion('version', [currentDocument, legacyDocument])
  .transform((value) => ({ version: 2, imageId: value.imageId }));
const defaults = () => ({ version: 2, imageId: null });

// Uploads are canvas-normalized PNGs. Check structure and dimensions on the
// server too; a caller does not have to use the file picker.
function validatePng(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX_IMAGE_BYTES || bytes.length < 45
    || !bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
    || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') {
    throw Object.assign(new Error('Invalid background image'), { status: 400 });
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (!width || !height || width > 10_000 || height > 10_000) {
    throw Object.assign(new Error('Background dimensions exceed the limit'), { status: 400 });
  }
  let hasData = false;
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const end = offset + length + 12;
    if (end > bytes.length || type === 'acTL') break;
    if (type === 'IDAT' && length > 0) hasData = true;
    if (type === 'IEND' && length === 0 && end === bytes.length && hasData) return;
    offset = end;
  }
  throw Object.assign(new Error('Invalid background image'), { status: 400 });
}

async function publish(file, bytes) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await fs.open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

export function createChatBackgroundStore(directory, { writeFile = publish } = {}) {
  const manifest = path.join(directory, 'background.json');
  let writes = Promise.resolve();
  const imagePath = (id) => path.join(directory, `${imageId.parse(id)}.png`);
  const read = async () => {
    try {
      return documentSchema.parse(JSON.parse(await fs.readFile(manifest, 'utf8')));
    } catch (error) {
      if (error.code === 'ENOENT') return defaults();
      throw error;
    }
  };
  const mutate = (transform) => {
    const operation = writes.then(async () => {
      const previous = await read();
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      const next = await transform(previous);
      try {
        await writeFile(manifest, JSON.stringify(next));
      } catch (error) {
        if (next.imageId && next.imageId !== previous.imageId) {
          await fs.rm(imagePath(next.imageId), { force: true });
        }
        throw error;
      }
      // Only remove assets this store owns, after the new manifest commits.
      // Retrying a later mutation also cleans up an interrupted upload.
      for (const name of await fs.readdir(directory).catch(() => [])) {
        if (/^[a-f0-9]{64}\.png$/.test(name) && name !== `${next.imageId}.png`) {
          await fs.rm(path.join(directory, name), { force: true }).catch(() => {});
        }
      }
      return next;
    });
    writes = operation.catch(() => {});
    return operation;
  };
  return {
    read,
    upload: (bytes) => {
      validatePng(bytes);
      const id = createHash('sha256').update(bytes).digest('hex');
      return mutate(async (previous) => {
        await writeFile(imagePath(id), bytes);
        return { ...previous, imageId: id };
      });
    },
    remove: () => mutate((previous) => ({ ...previous, imageId: null })),
    image: async (id) => {
      if (!imageId.safeParse(id).success || (await read()).imageId !== id) {
        throw Object.assign(new Error('Background image not found'), { status: 404 });
      }
      return fs.readFile(imagePath(id));
    },
  };
}
