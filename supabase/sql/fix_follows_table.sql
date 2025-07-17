-- Fix the follows table issue
-- The app code uses 'follows' table, but the migration created 'followers' table

-- First, check if follows table exists, if not create it
CREATE TABLE IF NOT EXISTS public.follows (
    follower_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    following_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at timestamptz DEFAULT now() NOT NULL,
    -- A user can only follow another user once
    CONSTRAINT follows_pkey PRIMARY KEY (follower_id, following_id)
);

-- Enable Row Level Security
ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;

-- Allow users to follow others (insert their own row)
CREATE POLICY IF NOT EXISTS "Users can insert their own follows"
ON public.follows
FOR INSERT
WITH CHECK (auth.uid() = follower_id);

-- Allow all authenticated users to read the follow relationships
CREATE POLICY IF NOT EXISTS "Users can view follows"
ON public.follows
FOR SELECT
USING (auth.role() = 'authenticated');

-- Allow users to unfollow (delete their own row)
CREATE POLICY IF NOT EXISTS "Users can delete their own follows"
ON public.follows
FOR DELETE
USING (auth.uid() = follower_id);

-- If followers table exists, migrate data from followers to follows
INSERT INTO public.follows (follower_id, following_id, created_at)
SELECT follower_id, following_id, created_at
FROM public.followers
ON CONFLICT (follower_id, following_id) DO NOTHING;

-- Drop the followers table since we're using follows
DROP TABLE IF EXISTS public.followers;

-- Enable the http extension for making HTTP requests
CREATE EXTENSION IF NOT EXISTS "http" WITH SCHEMA "extensions";

-- Function to send push notification when someone follows a user
CREATE OR REPLACE FUNCTION send_new_follower_notification()
RETURNS TRIGGER AS $$
BEGIN
  -- Call the edge function to send push notification
  PERFORM
    net.http_post(
      url := 'https://ujmbtqyqwiqfblnerahv.supabase.co/functions/v1/send-push',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVqbWJ0cXlxd2lxZmJsbmVyYWh2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDY5MTg4NzAsImV4cCI6MjA2MjQ5NDg3MH0.ITeovQCWW_Ya2_YkAr8kKr3UQZT4_f1jgxQdNFRNAzE"}',
      body := json_build_object(
        'userId', NEW.following_id,
        'title', '👥 New Follower!',
        'body', 'Someone just followed you on RunCrew',
        'data', json_build_object(
          'type', 'new_follower',
          'followerId', NEW.follower_id
        )
      )::text
    );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS trigger_new_follower_notification ON follows;
DROP TRIGGER IF EXISTS trg_new_follower ON follows;

-- Create trigger to call the function when a new follow is created
CREATE TRIGGER trigger_new_follower_notification
  AFTER INSERT ON follows
  FOR EACH ROW
  EXECUTE FUNCTION send_new_follower_notification(); 