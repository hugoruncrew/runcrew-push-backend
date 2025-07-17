const { Expo } = require('expo-server-sdk');
const { createClient } = require('@supabase/supabase-js');

// Initialize Expo SDK
const expo = new Expo();

// Initialize Supabase client
const supabaseUrl = 'https://ujmbtqyqwiqfblnerahv.supabase.co';
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVqbWJ0cXlxd2lxZmJsbmVyYWh2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0NjkxODg3MCwiZXhwIjoyMDYyNDk0ODcwfQ.-7tnjlZsRMVjrxaHglSlE9jGzcqRrjKIvgLRDcpLWi8';
const supabase = createClient(supabaseUrl, supabaseServiceKey);

/**
 * Send run reminder notifications
 * @param {string} reminderType - 'day_before' or 'hour_before'
 */
async function sendRunReminders(reminderType = 'day_before') {
  try {
    console.log(`Starting ${reminderType} run reminders...`);
    
    const now = new Date();
    let timeFilter;
    
    if (reminderType === 'day_before') {
      // Find runs starting in the next 24 hours (between now and 24 hours from now)
      const twentyFourHoursFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const fortyEightHoursFromNow = new Date(now.getTime() + 48 * 60 * 60 * 1000);
      
      timeFilter = `start_time >= '${twentyFourHoursFromNow.toISOString()}' AND start_time < '${fortyEightHoursFromNow.toISOString()}'`;
    } else if (reminderType === 'hour_before') {
      // Find runs starting in the next hour
      const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
      const twoHoursFromNow = new Date(now.getTime() + 2 * 60 * 60 * 1000);
      
      timeFilter = `start_time >= '${oneHourFromNow.toISOString()}' AND start_time < '${twoHoursFromNow.toISOString()}'`;
    } else {
      throw new Error('Invalid reminder type');
    }

    console.log(`Time filter: ${timeFilter}`);
    console.log(`Current time: ${now.toISOString()}`);

    // Get all runs that match the time criteria
    const { data: runs, error: runsError } = await supabase
      .from('runs')
      .select(`
        id,
        title,
        run_date,
        start_time,
        clubs (
          name,
          logo_url
        )
      `)
      .filter(timeFilter);

    if (runsError) {
      console.error('Error fetching runs:', runsError);
      return;
    }

    console.log(`Found ${runs.length} runs for ${reminderType} reminders:`, runs.map(r => ({ id: r.id, title: r.title, start_time: r.start_time })));

    // For each run, get attendees and send notifications
    for (const run of runs) {
      await sendRemindersForRun(run, reminderType);
    }

    console.log(`Completed ${reminderType} run reminders`);
  } catch (error) {
    console.error('Error sending run reminders:', error);
  }
}

/**
 * Send reminders for a specific run
 */
async function sendRemindersForRun(run, reminderType) {
  try {
    // Get all attendees for this run
    const { data: attendees, error: attendeesError } = await supabase
      .from('run_attendees')
      .select(`
        user_id,
        profiles (
          username,
          first_name,
          last_name
        )
      `)
      .eq('run_id', run.id);

    if (attendeesError) {
      console.error(`Error fetching attendees for run ${run.id}:`, attendeesError);
      return;
    }

    console.log(`Sending ${reminderType} reminders for run ${run.id} to ${attendees.length} attendees`);

    // Get push tokens for all attendees
    const userIds = attendees.map(a => a.user_id);
    const { data: tokens, error: tokensError } = await supabase
      .from('device_push_tokens')
      .select('user_id, token')
      .in('user_id', userIds);

    if (tokensError) {
      console.error('Error fetching push tokens:', tokensError);
      return;
    }

    // Group tokens by user
    const tokensByUser = {};
    tokens.forEach(t => {
      if (!tokensByUser[t.user_id]) {
        tokensByUser[t.user_id] = [];
      }
      tokensByUser[t.user_id].push(t.token);
    });

    // Create notification messages
    const messages = [];
    const runDate = new Date(run.run_date);
    const formattedDate = runDate.toLocaleDateString('en-US', { 
      weekday: 'long', 
      month: 'short', 
      day: 'numeric' 
    });
    const formattedTime = run.start_time || 'TBD';

    for (const attendee of attendees) {
      const userTokens = tokensByUser[attendee.user_id] || [];
      const profile = attendee.profiles;
      const displayName = profile?.first_name 
        ? `${profile.first_name} ${profile.last_name || ''}`.trim()
        : profile?.username || 'Runner';

      let title, body;
      if (reminderType === 'day_before') {
        title = '🏃‍♂️ Run in 24 Hours!';
        body = `Don't forget: ${run.title} in 24 hours at ${formattedTime}`;
      } else {
        title = '⏰ Run in 1 Hour!';
        body = `Your run "${run.title}" starts in 1 hour`;
      }

      // Create notification record
      await supabase
        .from('notifications')
        .insert({
          user_id: attendee.user_id,
          type: 'run_reminder',
          seen: false,
          payload: {
            run_id: run.id,
            run_title: run.title,
            run_date: run.run_date,
            start_time: run.start_time,
            club_name: run.clubs?.name,
            reminder_type: reminderType
          },
          pushed: false
        });

      // Create push notification messages
      userTokens.forEach(token => {
        if (Expo.isExpoPushToken(token)) {
          messages.push({
            to: token,
            sound: 'default',
            title: title,
            body: body,
            data: {
              type: 'run_reminder',
              run_id: run.id,
              run_title: run.title,
              reminder_type: reminderType,
              screen: 'Run',
              runId: run.id
            }
          });
        }
      });
    }

    // Send push notifications
    if (messages.length > 0) {
      const chunks = expo.chunkPushNotifications(messages);
      const tickets = [];

      for (const chunk of chunks) {
        try {
          const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
          tickets.push(...ticketChunk);
        } catch (error) {
          console.error('Error sending notification chunk:', error);
          tickets.push(...chunk.map(() => ({ error })));
        }
      }

      // Log results
      const errors = tickets
        .map((ticket, index) => {
          if (ticket.error) {
            return {
              token: messages[index]?.to,
              error: ticket.error
            };
          }
          return null;
        })
        .filter(Boolean);

      console.log(`Run reminder results for ${run.id}:`, {
        total: tickets.length,
        errors: errors.length,
        errors
      });
    }

  } catch (error) {
    console.error(`Error sending reminders for run ${run.id}:`, error);
  }
}

// Export functions for use in cron jobs or manual execution
module.exports = {
  sendRunReminders,
  sendDayBeforeReminders: () => sendRunReminders('day_before'),
  sendHourBeforeReminders: () => sendRunReminders('hour_before')
};

// If running directly, send day before reminders
if (require.main === module) {
  const reminderType = process.argv[2] || 'day_before';
  sendRunReminders(reminderType)
    .then(() => {
      console.log('Run reminders completed');
      process.exit(0);
    })
    .catch(error => {
      console.error('Run reminders failed:', error);
      process.exit(1);
    });
} 