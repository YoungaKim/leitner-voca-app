import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // @leitner/core는 발행된 패키지가 아니라 워크스페이스 내 TS 소스라 esbuild
  // 의존성 사전 번들링 대상에서 빼야 한다(안 빼면 dev 서버가 깨진 번들을 참조해
  // 모듈 로드 시 404가 나고 React가 마운트되지 못해 검은 빈 화면이 뜬다).
  optimizeDeps: {
    exclude: ['@leitner/core'],
  },
  server: {
    // 이 프로젝트 경로에 한글이 들어있어 macOS(NFD)와 Node 문자열(NFC)의 유니코드
    // 정규화 형태가 달라 fs.allow의 경로 접두사 비교가 항상 실패한다(같은 경로인데도
    // 바이트가 달라서 벌어지는 문제). packages/core를 dev 서버가 읽어야 하므로
    // 이 프로젝트에서는 strict 검사를 끈다.
    fs: {
      strict: false,
    },
  },
})
