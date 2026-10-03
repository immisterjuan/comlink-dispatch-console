import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

let client = null;
let initialized = false;

try {
  if (supabaseUrl && supabaseAnonKey) {
    client = createClient(supabaseUrl, supabaseAnonKey);
    initialized = true;
  } else {
    console.warn('Supabase initialization skipped: missing URL or Anon Key.');
  }
} catch (error) {
  console.error('Supabase initialization failed:', error);
}

export const supabase = client;
export const isSupabaseInitialized = initialized;
