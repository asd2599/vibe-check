import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // vibecheck: 문제 세트의 starter 코드는 벤치마크용 픽스처다(의도적으로 레거시 스타일 등을
    // 담을 수 있음) — 우리 앱 코드가 아니므로 린트 대상에서 제외한다.
    "problems/**",
    // 실행별 임시 워크스페이스 — gitignore 대상이자 러너/CLI가 생성한 산출물, 우리 코드가 아니다.
    "workspaces/**",
  ]),
]);

export default eslintConfig;
