-- Migration: add push notification on new follower
-- Creates notifications table (optional feed) and trigger that POSTs to edge function send-push

-- 1. notifications audit table
create table if not exists notifications (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  data jsonb not null,
  created_at timestamptz default now()
);

alter table notifications enable row level security;

-- Allow users to read their own notifications
create policy "Users can read their notifications" on notifications
  for select using (auth.uid() = user_id);

-- 2. function & trigger on followers
create or replace function public.notify_new_follower()
returns trigger as $$
declare
  follower_username text;
  resp json;
begin
  -- Lookup username for message
  select username into follower_username from profiles where id = NEW.follower_id;

  -- insert feed row
  insert into notifications (user_id, type, data)
  values (NEW.following_id, 'new_follower', jsonb_build_object('follower_id', NEW.follower_id));

  -- Build payload and call edge function asynchronously via pg_net
  perform
    net.http_post(
      url := 'https://ujmbtqyqwiqfblnerahv.functions.supabase.co/send-push',
      headers := '{"Content-Type":"application/json"}',
      body := json_build_object(
        'userId', NEW.following_id,
        'title', 'New follower 🎉',
        'body', coalesce(follower_username, 'Someone') || ' started following you',
        'data', json_build_object('screen','Runner','params', json_build_object('runnerId', NEW.follower_id))
      )::text,
      timeout_milliseconds := 8000
    ) into resp;
  return NEW;
end;
$$ language plpgsql security definer;

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
        'title', 'New Follower!',
        'body', 'Someone just followed you on RunCrew',
        'data', json_build_object(
          'type', 'new_follower',
          'followerId', NEW.follower_id
        )
      )::text
    );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to call the function when a new follow is created
CREATE TRIGGER trigger_new_follower_notification
  AFTER INSERT ON follows
  FOR EACH ROW
  EXECUTE FUNCTION send_new_follower_notification();

-- Create the followers table to track who follows whom
CREATE TABLE public.followers (
    follower_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    following_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at timestamptz DEFAULT now() NOT NULL,
    -- A user can only follow another user once
    CONSTRAINT followers_pkey PRIMARY KEY (follower_id, following_id)
);

-- Enable Row Level Security
ALTER TABLE public.followers ENABLE ROW LEVEL SECURITY;

-- Allow users to follow others (insert their own row)
CREATE POLICY "Users can insert their own follows"
ON public.followers
FOR INSERT
WITH CHECK (auth.uid() = follower_id);

-- Allow all authenticated users to read the follow relationships
CREATE POLICY "Users can view follows"
ON public.followers
FOR SELECT
USING (auth.role() = 'authenticated');

-- Allow users to unfollow (delete their own row)
CREATE POLICY "Users can delete their own follows"
ON public.followers
FOR DELETE
USING (auth.uid() = follower_id);

drop trigger if exists trg_new_follower on followers;
create trigger trg_new_follower
  after insert on followers
  for each row execute procedure public.notify_new_follower(); 