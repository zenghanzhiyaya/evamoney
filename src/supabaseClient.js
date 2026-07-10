import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://mtgobssmgtetqjgvqrot.supabase.co";
const supabaseAnonKey = "sb_publishable_sDDoQy-ea_GCsfX3sg2epw_B-pbJVvP";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
