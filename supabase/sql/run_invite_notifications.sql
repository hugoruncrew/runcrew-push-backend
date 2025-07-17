-- Function to send push notification when someone is invited to a run
CREATE OR REPLACE FUNCTION send_run_invite_notification()
RETURNS TRIGGER AS $$
BEGIN
  -- Call the edge function to send push notification
  PERFORM
    net.http_post(
      url := 'https://ujmbtqyqwiqfblnerahv.supabase.co/functions/v1/send-push',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVqbWJ0cXlxd2lxZmJsbmVyYWh2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDY5MTg4NzAsImV4cCI6MjA2MjQ5NDg3MH0.ITeovQCWW_Ya2_YkAr8kKr3UQZT4_f1jgxQdNFRNAzE"}',
      body := json_build_object(
        'userId', NEW.user_id,
        'title', '🏃‍♂️ Run Invite!',
        'body', 'You have been invited to join a run',
        'data', json_build_object(
          'type', 'run_invite',
          'runId', NEW.run_id
        )
      )::text
    );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to call the function when a run invite is created
CREATE TRIGGER trigger_run_invite_notification
  AFTER INSERT ON run_invites
  FOR EACH ROW
  EXECUTE FUNCTION send_run_invite_notification(); 