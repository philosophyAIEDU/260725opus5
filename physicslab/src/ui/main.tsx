import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.tsx';
import { validateAllStages } from '../content/index.ts';
import './styles.css';

// 개발 중에는 스테이지 정의 실수를 콘솔에 바로 알려줍니다.
if (import.meta.env.DEV) {
  const bad = validateAllStages();
  if (bad.length > 0) console.error('스테이지 정의 오류', bad);
}

const el = document.getElementById('root');
if (el) {
  createRoot(el).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
