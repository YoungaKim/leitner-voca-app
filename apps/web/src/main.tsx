import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import App from "./App.tsx";

// StrictMode는 의도적으로 뺐다: StudySessionPage의 세션 시작 effect가
// 저수지 카드를 IndexedDB에 승격(introduceCard)하는데, StrictMode의 effect 이중 호출이
// 이 쓰기를 중복 실행할 수 있어 학습 세션 페이지와는 상성이 안 좋다.
createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
);
