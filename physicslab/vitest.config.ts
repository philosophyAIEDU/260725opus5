import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // 해석해 대조 테스트는 장시간(120초 시뮬 등) 적분을 돌립니다.
    testTimeout: 120_000,
    hookTimeout: 30_000,
  },
});
