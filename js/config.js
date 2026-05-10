// ─── Supabase Configuration ───────────────────────────────
// The anon key is safe to expose in frontend code.
// It is restricted by Row Level Security — only authenticated
// users can read or write data.

export const SUPABASE_URL  = 'https://uonfyoyzdmzuqremlqgs.supabase.co';
export const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVvbmZ5b3l6ZG16dXFyZW1scWdzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg0MDAzNjcsImV4cCI6MjA5Mzk3NjM2N30.8K44xOTz2-7D0ZcHuQJ3oZNXtJD8FDh13JvDQ_YoFxQ';

// ─── Ralph & Csilla macro multipliers ────────────────────
// Macros in DB are Csilla's serving. Ralph's are scaled here.
export const RALPH_MULTIPLIERS = {
  kcal:    1.31,
  protein: 1.32,
  carbs:   1.28,
  fat:     1.20
};

export const PROFILES = {
  ralph:  { name: 'Ralph',  age: 30, height: 180, weight: 85,  kcal: 2300, protein: 140 },
  csilla: { name: 'Csilla', age: 29, height: 156, weight: 56,  kcal: 1750, protein: 95  }
};
