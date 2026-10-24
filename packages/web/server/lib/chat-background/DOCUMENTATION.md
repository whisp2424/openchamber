# Workspace background

## Ownership

This personal-fork module owns the server's shared workspace background. Routes use
the existing UI authentication middleware and are registered before the OpenCode
proxy. The UI uses authenticated fetches and object URLs for image display.
No public asset route, external image URL, or filesystem path is accepted.

## Invariants

- Files live in `<OPENCHAMBER_DATA_DIR>/chat-background/`: `background.json`
  stores the selected image hash, and the image is `<sha256>.png`. Version 2
  has only `imageId`; missing means the default background. Reads normalize the
  previous version-1 dimming-and-blur manifest to version 2; the next mutation
  persists version 2 while preserving its image hash. Malformed or unreadable
  data is an error and cannot be overwritten by a mutation.
- Uploaded bytes are bounded to 20 MiB and static PNGs with each dimension at
  most 10,000 pixels. The picker accepts source files up to 20 MiB, decodes PNG,
  JPEG, and WebP locally, resizes them to 1920 pixels on the longest edge, and
  rasterizes them before upload. There is no source pixel-count limit.
- Mutations run in request order within the server. They publish the asset
  before atomically replacing the manifest. Failed manifest writes preserve the
  previous selection and clean up the new asset.
- Removal commits the empty selection before deleting images. Cleanup failure
  does not invalidate a committed selection; the next mutation retries cleanup.
- Image reads accept only the currently selected content hash. Files and
  manifest use private permissions on systems that support them.
- Clients refresh when mounted, focused, or made visible. There is no polling
  or instant cross-client notification. Another open client sees changes on its
  next refresh.

## Decisions

### Why separate files from standard preferences

This feature lives only in the personal fork. Dedicated storage avoids changing
upstream's generated preference registry and keeps background assets out of
settings synchronization payloads.

### Why normalize images in the browser

Rasterizing the selected file strips metadata and animation without adding a
server image-decoder dependency. The 20 MiB byte cap bounds uploads and stored
files, and resizing bounds normalized dimensions. The server validates PNG
structure and limits each uploaded dimension to 10,000 pixels.
Invalid image decoding falls back to the theme.
