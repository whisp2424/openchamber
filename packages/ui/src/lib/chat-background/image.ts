const MAX_INPUT_BYTES = 20 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;

export class BackgroundImageError extends Error {
  constructor(public readonly reason: 'invalid' | 'size') {
    super(reason);
  }
}

export async function prepareBackgroundImage(file: File): Promise<Blob> {
  if (file.size > MAX_INPUT_BYTES) throw new BackgroundImageError('size');
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new BackgroundImageError('invalid');
  const source = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = source;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new BackgroundImageError('invalid');
    const scale = Math.min(1, 1920 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new BackgroundImageError('invalid');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!png) throw new BackgroundImageError('invalid');
    if (png.size > MAX_OUTPUT_BYTES) throw new BackgroundImageError('size');
    return png;
  } finally {
    URL.revokeObjectURL(source);
  }
}
