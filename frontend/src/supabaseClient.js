import { createClient } from '@supabase/supabase-js';

// Você pega esses dados lá no painel do Supabase em:
// Project Settings (Engrenagem) -> API
const supabaseUrl = 'https://tepwrxzrgvdyhlxfnwdr.supabase.co';
const supabaseKey = 'sb_publishable_BSxx3dMunXTkTZSy-AzA3w_5GdYC_1y';

export const supabase = createClient(supabaseUrl, supabaseKey);