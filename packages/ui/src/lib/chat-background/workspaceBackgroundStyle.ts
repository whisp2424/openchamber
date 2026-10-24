import type { CSSProperties } from 'react';
import './background.css';

export function workspaceBackgroundStyle(imageUrl: string | null): CSSProperties | undefined {
  if (!imageUrl) return undefined;
  return {
    backgroundColor: 'var(--background)',
    backgroundImage: `linear-gradient(to top, var(--background), color-mix(in srgb, var(--background) var(--oc-workspace-background-fade), transparent)), url("${imageUrl}")`,
    backgroundPosition: 'center, center',
    backgroundRepeat: 'no-repeat, no-repeat',
    backgroundSize: 'cover, cover',
  };
}
