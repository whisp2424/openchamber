import path from 'node:path';
import express from 'express';
import { ZodError } from 'zod';
import { createChatBackgroundStore, MAX_IMAGE_BYTES } from './store.js';

export function registerChatBackgroundRoutes(app, { openchamberDataDir }) {
  const store = createChatBackgroundStore(path.join(openchamberDataDir, 'chat-background'));
  const route = '/api/chat-background';
  const respond = (operation) => async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      res.json(await operation(req));
    } catch (error) {
      res.status(error instanceof ZodError ? 400 : error.status ?? 500).json({ error: 'background' });
    }
  };
  app.get(route, respond(() => store.read()));
  app.put(`${route}/image`, express.raw({ type: 'image/png', limit: MAX_IMAGE_BYTES }), respond((req) => store.upload(req.body)));
  app.delete(`${route}/image`, respond(() => store.remove()));
  app.get(`${route}/image/:id`, async (req, res) => {
    try {
      const bytes = await store.image(req.params.id);
      res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
      res.send(bytes);
    } catch (error) {
      res.status(error.status ?? 500).json({ error: 'background' });
    }
  });
}
