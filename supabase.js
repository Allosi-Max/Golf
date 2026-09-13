import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://uzbvdcjlmuebagmuzjjq.supabase.co';
const SUPABASE_KEY = 'sb_publishable_VpY-whcBxsbYfmKeTAFRoQ_o3spwKEa';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);