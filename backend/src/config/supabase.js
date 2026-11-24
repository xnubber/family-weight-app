import { createClient } from '@supabase/supabase-js';
import { config } from './env.js';

let client = null;

export function getSupabaseClient() {
  if (!client) {
    client = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);
  }
  return client;
}
