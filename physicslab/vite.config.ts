import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 정적 빌드만 합니다. 서버도, 외부 통신도, 런타임 CDN 로드도 없습니다.
 * base 를 './' 로 두어 어떤 하위 경로에 올려도 그대로 동작합니다
 * (학교에서 폴더째 복사해 쓰는 경우 대비).
 */
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    target: 'es2022',
    reportCompressedSize: true,
    chunkSizeWarningLimit: 400,
  },
});
