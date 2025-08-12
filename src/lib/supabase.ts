import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://bdlnocdyelsogbgjxleg.supabase.co'
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJkbG5vY2R5ZWxzb2diZ2p4bGVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ5NjIwMTMsImV4cCI6MjA3MDUzODAxM30.69eBl1bo3OW88t9WRR-DCN5uq53AHx5EdzL-3ct-A_s'

export const supabase = createClient(supabaseUrl, supabaseKey)

export type StudySet = {
  id?: string
  title: string
  questions: Array<{
    question: string
    answer: string
  }>
  created_at?: string
  user_id?: string
}

export type StudyProgress = {
  id?: string
  study_set_id: string
  question_index: number
  is_known: boolean
  last_reviewed: string
  user_id?: string
}