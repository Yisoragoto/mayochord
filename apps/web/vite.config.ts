import { copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

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

export default defineConfig({
  // 部署到 <user>.github.io/mayochord/；可用 MAYOCHORD_BASE 覆盖（例如自定义域名时设为 '/'）
  base: process.env.MAYOCHORD_BASE ?? '/mayochord/',
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    spaFallback(),
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
