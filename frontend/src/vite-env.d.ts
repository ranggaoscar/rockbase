/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ROCKBASE_MODE?: 'local' | 'server'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
