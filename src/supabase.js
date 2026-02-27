import { createClient } from '@supabase/supabase-js'

// Ilalagay mo ang sarili mong values dito mula sa Supabase dashboard
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
