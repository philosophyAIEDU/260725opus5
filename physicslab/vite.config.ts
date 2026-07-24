import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * 빌드 경로는 3가지입니다.
 *   npm run dev          — 개발 서버
 *   npm run build        — 일반 정적 빌드 (dist/), PWA(오프라인) 포함
 *   npm run build:single — mode=single. 단일 HTML 한 장으로 산출.
 *
 * single 모드에서는 PWA를 끕니다. 서비스워커는 별도 파일을 요구하는데
 * 단일 HTML 배포(파일을 그냥 복사해서 나눠주는 용도)에서는 등록 자체가 불가능하고,
 * file:// 프로토콜에서는 SW 등록이 브라우저 정책상 거부되기 때문입니다.
 */
export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  return {
    base: './',
    plugins: [
      react(),
      ...(single
        ? [viteSingleFile({ removeViteModuleLoader: true })]
        : [
            VitePWA({
              registerType: 'autoUpdate',
              includeAssets: ['favicon.svg'],
              manifest: {
                name: 'PhysicsLab: 예측 실험실',
                short_name: 'PhysicsLab',
                description: '고등학생용 물리 시뮬레이션 학습 플랫폼',
                lang: 'ko',
                start_url: './',
                scope: './',
                display: 'standalone',
                background_color: '#0f1420',
                theme_color: '#0f1420',
                icons: [
                  { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
                  { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
                  {
                    src: 'icon-512.png',
                    sizes: '512x512',
                    type: 'image/png',
                    purpose: 'maskable',
                  },
                ],
              },
              workbox: {
                globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
                // 외부 통신이 전혀 없는 앱이므로 런타임 캐싱 규칙도 필요 없습니다.
                navigateFallback: 'index.html',
              },
            }),
          ]),
    ],
    worker: {
      format: 'es',
    },
    build: {
      target: 'es2022',
      // 단일 파일 빌드에서는 인라인 한계를 없애야 워커/에셋이 HTML 안으로 들어갑니다.
      assetsInlineLimit: single ? 100_000_000 : 4096,
      cssCodeSplit: !single,
      rollupOptions: single
        ? { output: { inlineDynamicImports: true } }
        : undefined,
      reportCompressedSize: true,
      chunkSizeWarningLimit: 400,
    },
    define: {
      __SINGLE_FILE__: JSON.stringify(single),
    },
  };
});
