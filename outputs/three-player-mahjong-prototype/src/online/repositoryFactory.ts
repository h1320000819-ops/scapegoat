import type { AppRepositories } from "./repositories";
import { createLocalRepositories } from "./localRepositories";
import { isSupabaseConfigured, supabase } from "./supabaseClient";
import { createSupabaseRepositories } from "./supabaseRepositories";

export function createAppRepositories(): AppRepositories {
  const backend = import.meta.env.VITE_REPOSITORY_BACKEND ?? "local";
  if (backend === "supabase") {
    if (!isSupabaseConfigured || !supabase) {
      throw new Error("Supabase backend selected but VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are missing.");
    }
    return createSupabaseRepositories(supabase);
  }
  return createLocalRepositories();
}
