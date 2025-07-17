-- Simple fix for the follows table issue
-- Create the follows table that the app expects

CREATE TABLE IF NOT EXISTS public.follows (
    follower_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    following_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT follows_pkey PRIMARY KEY (follower_id, following_id)
);

-- Enable RLS
ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;

-- Drop any existing policies
DROP POLICY IF EXISTS "Users can insert their own follows" ON public.follows;
DROP POLICY IF EXISTS "Users can view follows" ON public.follows;
DROP POLICY IF EXISTS "Users can delete their own follows" ON public.follows;

-- Create policies
CREATE POLICY "Users can insert their own follows"
ON public.follows FOR INSERT
WITH CHECK (auth.uid() = follower_id);

CREATE POLICY "Users can view follows"
ON public.follows FOR SELECT
USING (auth.role() = 'authenticated');

CREATE POLICY "Users can delete their own follows"
ON public.follows FOR DELETE
USING (auth.uid() = follower_id);

-- Migrate data if followers table exists
INSERT INTO public.follows (follower_id, following_id, created_at)
SELECT follower_id, following_id, created_at
FROM public.followers
ON CONFLICT (follower_id, following_id) DO NOTHING;

-- Remove the wrong table
DROP TABLE IF EXISTS public.followers; 