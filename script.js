import { supabase } from './supabase.js';
import { createApp } from './js/app.js';

const app = createApp(supabase);
app.init();
