import { copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * GitHub Pages 的 SPA 回退：把 index.html 复制为 404.html。
 * 直接访问或刷新深链接时 Pages 返回 404.html（即完整应用），由客户端路由接管。
 */
function spaFallback(): Plugin {
  let outDir = 'dist';
  return {
    name: 'mayochord:spa-404-fallback',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      await copyFile(resolve(outDir, 'index.html'), resolve(outDir, '404.html'));
    },
  };
}

// 部署到 <user>.github.io/mayochord/；可用 MAYOCHORD_BASE 覆盖（例如自定义域名时设为 '/'）
const base = process.env.MAYOCHORD_BASE ?? '/mayochord/';

export default defineConfig({
  base,
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    spaFallback(),
    // PWA（规格 M6）：可以添加到主屏幕、离线使用。应用本体预缓存；
    // 字体子集与钢琴采样第一次用到时缓存（中文字体子集很多，不全部预下载）
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'MayoChord',
        short_name: 'MayoChord',
        description: '连接 MIDI 键盘练和弦：看名弹和弦、和弦切换、跟拍弹进行、听辨与读谱。',
        lang: 'zh-CN',
        start_url: base,
        scope: base,
        display: 'standalone',
        background_color: '#0b0d12',
        theme_color: '#0b0d12',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        // VexFlow（约 720 kB）也预缓存，离线时五线谱照常显示
        maximumFileSizeToCacheInBytes: 2 * 1024 * 1024,
        navigateFallback: `${base}index.html`,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.endsWith('.woff2'),
            handler: 'CacheFirst',
            options: { cacheName: 'fonts', expiration: { maxEntries: 300 } },
          },
          {
            urlPattern: ({ url }) => url.pathname.includes('/samples/'),
            handler: 'CacheFirst',
            options: { cacheName: 'piano-samples', expiration: { maxEntries: 100 } },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: { '@': resolve(import.meta.dirname, 'src') },
  },
  build: {
    // VexFlow（内嵌 Bravura 字体，约 720 kB）和 Tone.js 都是按需懒加载的独立 chunk，不影响首屏
    chunkSizeWarningLimit: 800,
  },
  server: { port: 5173, host: true },
  preview: { port: 4173 },
});
