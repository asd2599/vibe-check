import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 상위 디렉터리에 있는 무관한 lockfile 때문에 워크스페이스 루트를 잘못 추론하는 것을 방지.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
