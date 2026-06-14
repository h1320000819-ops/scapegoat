interface ImportMetaEnv {
  readonly VITE_REPOSITORY_BACKEND?: "local" | "supabase";
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
