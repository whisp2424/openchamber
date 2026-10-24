# Workspace background

## Ownership

This personal-fork module owns background loading, image preparation, preview
URLs, and Appearance controls. The web `MainLayout` and `MobileApp` paint the
image behind the chat workspace and its header. The server's `lib/chat-background`
module owns persistence and validation.

## Invariants

- Background work has one shared controller per active runtime, independent of
  session messages. Streaming and switching chats issue no background requests.
- The cost budget is one active image and object URL per window. Source files and
  locally resized PNG uploads are each limited to 20 MiB. Metadata refreshes
  download image bytes only for a new hash or after a failed download. There is
  no per-message work or animation.
- Mount, focus, visibility, and endpoint changes refresh metadata. An unchanged
  image hash reuses the single object URL. No timer runs while idle.
- Mutations are serialized. A mutation invalidates older reads. Runtime changes
  invalidate pending work, clear the old image, and revoke its URL immediately.
  A request already sent can finish on its original server; queued requests are
  canceled and never redirected to the new server.
- Failed metadata reads and writes preserve the previous confirmed background.
  A confirmed new selection with a failed image download falls back to the theme
  and reports a loading failure. Removing an image revokes its object URL after
  server confirmation.
- PNG, JPEG, and WebP selections are decoded locally, resized to at most 1920
  pixels on their longest edge, and rasterized as static PNG. Source and
  normalized files are each limited to 20 MiB. There is no source pixel-count
  limit. No source filename or metadata is uploaded.
- The image covers the workspace behind the header, chat, and context-panel
  containers. The right context container and rail show the image, with a top
  fade that follows the chat's top scroll shadow. Panel cards, sidebars,
  Settings, code, and controls retain their existing surfaces. Full-page
  surfaces use the theme background. While an on-demand full-page module loads,
  the header content is hidden while its space and theme fill stay in place.
  Appearance shows a framed, slightly muted 16:9 preview of the selected image,
  or the theme background when no image is selected. The preview opens the image
  picker and dims on hover or keyboard focus. On the chat page, the header fill
  follows the active timeline's top scroll shadow. There are no blur or dimming
  controls for the workspace background.
- Web, Electron, hosted mobile, and Capacitor use authenticated runtime fetches.
  VS Code issues no background requests and has no background controls.

## Decisions

### Why the background belongs to the layout

The layout owns the region behind the header, chat, and context-panel
containers. The right panel and rail use the same 48 px top fade as the chat;
one scroll state and one opacity transition keep their edges aligned. Panel
  cards keep their theme surfaces. Chat headers follow the active timeline's
  scroll state. Full-page surfaces hide the image and show the theme background.
  Their header content stays hidden while an on-demand module loads without
  changing layout.
