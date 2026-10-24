import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { crc32, deflateSync } from 'node:zlib';
import { registerChatBackgroundRoutes } from './routes.js';
import { createChatBackgroundStore, MAX_IMAGE_BYTES } from './store.js';
import { registerCommonRequestMiddleware } from '../opencode/core-routes.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jz1sAAAAASUVORK5CYII=', 'base64');
const pngChunk = (name, data) => {
  const type = Buffer.from(name);
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  type.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([type, data])), data.length + 8);
  return chunk;
};
const grayscalePng = (width, height) => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 1;
  header[9] = 0;
  const rowBytes = Math.ceil(width / 8) + 1;
  const scanlines = Buffer.alloc(height * rowBytes);
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
};

describe('personal chat background', () => {
  let directory;
  let app;
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-background-test-'));
    app = express();
    registerCommonRequestMiddleware(app, { express });
    registerChatBackgroundRoutes(app, { openchamberDataDir: directory });
  });
  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  test('allows uploads up to 20 MiB', () => {
    expect(MAX_IMAGE_BYTES).toBe(20 * 1024 * 1024);
  });

  test('shares a persistent workspace image through the authenticated-fetch route', async () => {
    const initial = await request(app).get('/api/chat-background').expect(200);
    expect(initial.body).toEqual({ version: 2, imageId: null });
    expect(initial.headers['cache-control']).toBe('no-store');
    const uploaded = await request(app).put('/api/chat-background/image').set('Content-Type', 'image/png').send(png).expect(200);
    const id = uploaded.body.imageId;
    expect(id).toMatch(/^[a-f0-9]{64}$/);
    const image = await request(app).get(`/api/chat-background/image/${id}`).expect(200);
    expect(image.headers['content-type']).toBe('image/png');
    expect(image.headers['x-content-type-options']).toBe('nosniff');
    expect(image.body).toEqual(png);
    const anotherClient = createChatBackgroundStore(path.join(directory, 'chat-background'));
    expect(await anotherClient.read()).toEqual({ version: 2, imageId: id });
    await request(app).delete('/api/chat-background/image').expect(200);
    expect((await anotherClient.read()).imageId).toBeNull();
    await request(app).get(`/api/chat-background/image/${id}`).expect(404);
    expect(await fs.readdir(path.join(directory, 'chat-background'))).toEqual(['background.json']);
  });

  test('rejects URLs, unsafe image IDs, oversized images, and invalid bytes', async () => {
    await request(app).patch('/api/chat-background').send({ url: 'https://example.com/image.png' }).expect(404);
    await request(app).put('/api/chat-background/image').send({ url: 'https://example.com/image.png' }).expect(400);
    await request(app).put('/api/chat-background/image').set('Content-Type', 'image/png').send(Buffer.from('<svg/>')).expect(400);
    await request(app).put('/api/chat-background/image').set('Content-Type', 'image/svg+xml').send('<svg/>').expect(400);
    await request(app).get('/api/chat-background/image/not-a-hash').expect(404);
    await request(app).get(`/api/chat-background/image/${'a'.repeat(64)}`).expect(404);
    await request(app).put('/api/chat-background/image').set('Content-Type', 'image/png').send(png.subarray(0, 40)).expect(400);
    const oversizedDimensions = Buffer.from(png);
    oversizedDimensions.writeUInt32BE(10_001, 16);
    await request(app).put('/api/chat-background/image').set('Content-Type', 'image/png').send(oversizedDimensions).expect(400);
    await request(app).put('/api/chat-background/image').set('Content-Type', 'image/png').send(Buffer.alloc(MAX_IMAGE_BYTES + 1)).expect(413);
  });

  test('accepts a valid image above the former 25-megapixel limit', async () => {
    const image = grayscalePng(5001, 5000);
    expect(5001 * 5000).toBeGreaterThan(25_000_000);
    expect(image.length).toBeLessThan(MAX_IMAGE_BYTES);
    const uploaded = await request(app).put('/api/chat-background/image').set('Content-Type', 'image/png').send(image).expect(200);
    expect(uploaded.body.imageId).toMatch(/^[a-f0-9]{64}$/);
  });

  test('serializes uploads and removals and removes stale assets', async () => {
    const store = createChatBackgroundStore(path.join(directory, 'chat-background'));
    await Promise.all([store.upload(png), store.remove(), store.upload(png)]);
    const state = await store.read();
    expect(state.imageId).toBeTruthy();
    await fs.writeFile(path.join(directory, 'chat-background', `${'f'.repeat(64)}.png`), png);
    await store.upload(png);
    expect((await fs.readdir(path.join(directory, 'chat-background'))).sort()).toEqual([`${state.imageId}.png`, 'background.json'].sort());
    await store.remove();
    await store.remove();
    expect(await store.read()).toEqual({ version: 2, imageId: null });
  });

  test('malformed storage remains an error and cannot be replaced with defaults', async () => {
    const location = path.join(directory, 'chat-background');
    await fs.mkdir(location);
    await fs.writeFile(path.join(location, 'background.json'), '{broken');
    await request(app).get('/api/chat-background').expect(500);
    await request(app).put('/api/chat-background/image').set('Content-Type', 'image/png').send(png).expect(500);
    expect(await fs.readFile(path.join(location, 'background.json'), 'utf8')).toBe('{broken');
  });

  test('failed manifest publication removes a newly written image and preserves the previous selection', async () => {
    const location = path.join(directory, 'chat-background');
    await createChatBackgroundStore(location).read();
    const store = createChatBackgroundStore(location, {
      writeFile: async (file, bytes) => {
        if (file.endsWith('background.json')) throw new Error('Disk write failed');
        await fs.writeFile(file, bytes);
      },
    });
    const previous = await store.read();
    await expect(store.upload(png)).rejects.toThrow('Disk write failed');
    expect(await store.read()).toEqual(previous);
    expect(await fs.readdir(location)).toEqual([]);
  });

  test('a filesystem write failure preserves the selected image and allows retry', async () => {
    const location = path.join(directory, 'chat-background');
    const store = createChatBackgroundStore(location);
    await store.upload(png);
    const previous = await store.read();
    // A read-only directory refuses temporary-file publication without replacing
    // the existing readable manifest. No module mocking is involved.
    await fs.chmod(location, 0o500);
    try {
      await expect(store.remove()).rejects.toThrow();
      expect(await store.read()).toEqual(previous);
    } finally {
      await fs.chmod(location, 0o700);
    }
    await store.remove();
    expect(await store.read()).toEqual({ version: 2, imageId: null });
  });

  test('reads the former dimming-and-blur manifest and writes the image-only version', async () => {
    const location = path.join(directory, 'chat-background');
    const store = createChatBackgroundStore(location);
    const { imageId } = await store.upload(png);
    await fs.writeFile(path.join(location, 'background.json'), JSON.stringify({
      version: 1, imageId, dimming: 45, blur: 2,
    }));
    expect(await store.read()).toEqual({ version: 2, imageId });
    await store.remove();
    expect(JSON.parse(await fs.readFile(path.join(location, 'background.json'), 'utf8')))
      .toEqual({ version: 2, imageId: null });
  });
});
