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

-- Create trigger to call the function when a new follow is created
CREATE TRIGGER trigger_new_follower_notification
  AFTER INSERT ON follows
  FOR EACH ROW
  EXECUTE FUNCTION send_new_follower_notification(); 