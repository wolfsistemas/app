import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabase = Boolean(url && key)
export const supabase = isSupabase ? createClient(url, key) : null
