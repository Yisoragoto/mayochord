import './i18n';
import '@fontsource-variable/noto-sans-sc';
import '@fontsource-variable/instrument-sans';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/jetbrains-mono';
// 只引入音乐符号子集：'Noto Music' 只负责 ♭ ♯ ♮ 等字形，其余字符回落到界面字体
import '@fontsource/noto-music/music-400.css';
import './index.css';

import { BUILTIN_DEVICE_PROFILES } from '@mayochord/content';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { webMidi } from './input/webmidi';
import { routeTree } from './routeTree.gen';
import { bindAppearanceToDocument } from './stores/appearance';

const router = createRouter({
  routeTree,
  basepath: import.meta.env.BASE_URL.replace(/\/$/, '') || '/',
  defaultPreload: 'intent',
  scrollRestoration: true,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

bindAppearanceToDocument();
webMidi.setPreferredProfiles([...BUILTIN_DEVICE_PROFILES]);

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root not found');
createRoot(rootEl).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
