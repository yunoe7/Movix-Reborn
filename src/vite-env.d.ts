/// <reference types="vite/client" />

declare const __MOVIX_BUILD_ID__: string;

declare module '*.woff2?url' {
  const src: string;
  export default src;
}
