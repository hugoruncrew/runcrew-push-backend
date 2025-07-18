const express = require('express');
const { Expo } = require('expo-server-sdk');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');
const { sendRunReminders } = require('./run-reminders');

const app = express();
const port = process.env.PORT || 3001;

// Initialize Expo SDK
const expo = new Expo();

// Initialize Supabase client
const supabaseUrl = 'https://ujmbtqyqwiqfblnerahv.supabase.co';
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVqbWJ0cXlxd2lxZmJsbmVyYWh2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0NjkxODg3MCwiZXhwIjoyMDYyNDk0ODcwfQ.-7tnjlZsRMVjrxaHglSlE9jGzcqRrjKIvgLRDcpLWi8'; // You'll need to get the service role key from Supabase dashboard
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Middleware
app.use(cors());
app.use(express.json());

// Follow user endpoint with push notification
app.post('/api/follow', async (req, res) => {
  try {
    const { follower_id, following_id } = req.body;

    console.log('Follow request:', { follower_id, following_id });

    // Validate required fields
    if (!follower_id || !following_id) {
      return res.status(400).json({
        error: 'Missing required fields: follower_id, following_id'
      });
    }

    // Prevent self-following
    if (follower_id === following_id) {
      return res.status(400).json({
        error: 'Users cannot follow themselves'
      });
    }

    // 1. Insert follow relationship
    const { error: followError } = await supabase
      .from('follows')
      .insert({
        follower_id,
        following_id,
        created_at: new Date().toISOString()
      });

    if (followError) {
      console.error('Error inserting follow:', followError);
      return res.status(400).json({
        error: 'Failed to create follow relationship',
        details: followError.message
      });
    }

    console.log('Follow relationship created successfully');

    // 2. Get follower's profile info for notification
    const { data: followerProfile, error: profileError } = await supabase
      .from('profiles')
      .select('username, first_name, last_name, avatar_url')
      .eq('id', follower_id)
      .single();

    if (profileError) {
      console.error('Error fetching follower profile:', profileError);
    }

    // 3. Get device push tokens for the followed user
    const { data: tokens, error: tokenError } = await supabase
      .from('device_push_tokens')
      .select('token')
      .eq('user_id', following_id);

    if (tokenError) {
      console.error('Error fetching push tokens:', tokenError);
    }

    // 4. Send push notification if tokens exist
    if (tokens && tokens.length > 0) {
      const validTokens = tokens
        .map(t => t.token)
        .filter(token => Expo.isExpoPushToken(token));

      if (validTokens.length > 0) {
        const followerName = followerProfile?.first_name 
          ? `${followerProfile.first_name} ${followerProfile.last_name || ''}`.trim()
          : followerProfile?.username || 'Someone';

        const messages = validTokens.map(token => ({
          to: token,
          sound: 'default',
          title: 'New Follower! 🎉',
          body: `${followerName} started following you`,
          data: {
            type: 'new_follower',
            follower_id: follower_id,
            screen: 'Runner',
            runnerId: follower_id
          }
        }));

        console.log('Sending follow notification to tokens:', validTokens.length);

        // Send messages in chunks
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
                token: validTokens[index],
                error: ticket.error
              };
            }
            return null;
          })
          .filter(Boolean);

        console.log('Follow notification results:', {
          total: tickets.length,
          errors: errors.length,
          errors
        });
      }
    }

    // 5. Insert notification record
    try {
      await supabase
        .from('notifications')
        .insert({
          user_id: following_id,
          type: 'follow',
          seen: false,
          payload: {
            follower_id: follower_id,
            follower_name: followerProfile?.first_name 
              ? `${followerProfile.first_name} ${followerProfile.last_name || ''}`.trim()
              : followerProfile?.username || 'Someone',
            follower_avatar_url: followerProfile?.avatar_url || null
          },
          pushed: false
        });
    } catch (notifError) {
      console.error('Error inserting notification record:', notifError);
    }

    res.json({
      success: true,
      message: 'Follow relationship created and notification sent',
      follower_id,
      following_id
    });

  } catch (error) {
    console.error('Error in follow handler:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

// Club run announcement endpoint with push notification
app.post('/api/club-run-announcement', async (req, res) => {
  try {
    const { run_id, club_id, created_by } = req.body;

    console.log('Club run announcement request:', { run_id, club_id, created_by });

    // Validate required fields
    if (!run_id || !club_id || !created_by) {
      return res.status(400).json({
        error: 'Missing required fields: run_id, club_id, created_by'
      });
    }

    // 1. Get run details
    const { data: runData, error: runError } = await supabase
      .from('runs')
      .select('title, run_date, location, start_time, is_public')
      .eq('id', run_id)
      .single();

    if (runError || !runData) {
      console.error('Error fetching run data:', runError);
      return res.status(400).json({
        error: 'Failed to fetch run data',
        details: runError?.message
      });
    }

    // Only send notifications for public runs
    if (!runData.is_public) {
      return res.json({
        success: true,
        message: 'Run is not public, no notifications sent',
        run_id,
        club_id
      });
    }

    // 2. Get club details
    const { data: clubData, error: clubError } = await supabase
      .from('clubs')
      .select('name')
      .eq('id', club_id)
      .single();

    if (clubError) {
      console.error('Error fetching club data:', clubError);
    }

    const clubName = clubData?.name || 'A club';

    // 3. Get all club followers
    const { data: followers, error: followersError } = await supabase
      .from('user_club_follows')
      .select('user_id')
      .eq('club_id', club_id);

    if (followersError) {
      console.error('Error fetching club followers:', followersError);
      return res.status(400).json({
        error: 'Failed to fetch club followers',
        details: followersError.message
      });
    }

    console.log(`Found ${followers.length} followers for club ${club_id}`);

    // 4. Send notifications to each follower
    let notificationCount = 0;
    let pushNotificationCount = 0;

    for (const follower of followers) {
      // Check if user has enabled club run announcements
      const { data: preferences, error: prefError } = await supabase
        .from('notification_preferences')
        .select('club_run_announcements')
        .eq('user_id', follower.user_id)
        .single();

      // Default to true if no preference is set
      const shouldNotify = preferences?.club_run_announcements !== false;

      if (!shouldNotify) {
        console.log(`Skipping notification for user ${follower.user_id} - club_run_announcements disabled`);
        continue;
      }

      // 5. Insert notification record
      try {
        await supabase
          .from('notifications')
          .insert({
            user_id: follower.user_id,
            type: 'club_run_announcement',
            seen: false,
            payload: {
              club_id: club_id,
              club_name: clubName,
              run_id: run_id,
              run_title: runData.title,
              run_date: runData.run_date,
              location: runData.location,
              start_time: runData.start_time
            },
            pushed: false
          });
        notificationCount++;
      } catch (notifError) {
        console.error('Error inserting notification record:', notifError);
      }

      // 6. Get device push tokens for the follower
      const { data: tokens, error: tokenError } = await supabase
        .from('device_push_tokens')
        .select('token')
        .eq('user_id', follower.user_id);

      if (tokenError) {
        console.error('Error fetching push tokens:', tokenError);
        continue;
      }

      // 7. Send push notification if tokens exist
      if (tokens && tokens.length > 0) {
        const validTokens = tokens
          .map(t => t.token)
          .filter(token => Expo.isExpoPushToken(token));

        if (validTokens.length > 0) {
          const messages = validTokens.map(token => ({
            to: token,
            sound: 'default',
            title: '🏃‍♂️ New Run Available!',
            body: `${clubName} has added a new run: ${runData.title || 'Untitled Run'}`,
            data: {
              type: 'club_run_announcement',
              clubId: club_id,
              runId: run_id,
              screen: 'Run',
              params: { runId: run_id }
            }
          }));

          console.log(`Sending club run notification to user ${follower.user_id} with ${validTokens.length} tokens`);

          // Send messages in chunks
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
                  token: validTokens[index],
                  error: ticket.error
                };
              }
              return null;
            })
            .filter(Boolean);

          console.log('Club run notification results:', {
            user_id: follower.user_id,
            total: tickets.length,
            errors: errors.length,
            errors
          });

          pushNotificationCount += tickets.length - errors.length;
        }
      }
    }

    res.json({
      success: true,
      message: 'Club run announcement sent',
      run_id,
      club_id,
      followers_count: followers.length,
      notifications_created: notificationCount,
      push_notifications_sent: pushNotificationCount
    });

  } catch (error) {
    console.error('Error in club run announcement handler:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

// Run reminder endpoints
app.post('/api/reminders/day-before', async (req, res) => {
  try {
    console.log('Triggering day-before run reminders...');
    await sendRunReminders('day_before');
    res.json({
      success: true,
      message: 'Day-before run reminders sent'
    });
  } catch (error) {
    console.error('Error sending day-before reminders:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

app.post('/api/reminders/hour-before', async (req, res) => {
  try {
    console.log('Triggering hour-before run reminders...');
    await sendRunReminders('hour_before');
    res.json({
      success: true,
      message: 'Hour-before run reminders sent'
    });
  } catch (error) {
    console.error('Error sending hour-before reminders:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

// Unfollow user endpoint
app.post('/api/unfollow', async (req, res) => {
  try {
    const { follower_id, following_id } = req.body;

    console.log('Unfollow request:', { follower_id, following_id });

    // Validate required fields
    if (!follower_id || !following_id) {
      return res.status(400).json({
        error: 'Missing required fields: follower_id, following_id'
      });
    }

    // Delete follow relationship
    const { error: unfollowError } = await supabase
      .from('follows')
      .delete()
      .eq('follower_id', follower_id)
      .eq('following_id', following_id);

    if (unfollowError) {
      console.error('Error deleting follow:', unfollowError);
      return res.status(400).json({
        error: 'Failed to delete follow relationship',
        details: unfollowError.message
      });
    }

    console.log('Follow relationship deleted successfully');

    res.json({
      success: true,
      message: 'Follow relationship deleted',
      follower_id,
      following_id
    });

  } catch (error) {
    console.error('Error in unfollow handler:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

// Push notification endpoint
app.post('/api/send-push', async (req, res) => {
  try {
    const { userId, title, body, data, tokens } = req.body;

    console.log('Received push notification request:', {
      userId,
      title,
      body,
      data,
      tokenCount: tokens?.length || 0
    });

    // Validate required fields
    if (!userId || !title || !body || !tokens || !Array.isArray(tokens)) {
      res.status(400).json({
        error: 'Missing required fields: userId, title, body, tokens (array)'
      });
      return;
    }

    // Validate tokens
    const validTokens = tokens.filter(token => Expo.isExpoPushToken(token));
    const invalidTokens = tokens.filter(token => !Expo.isExpoPushToken(token));

    if (invalidTokens.length > 0) {
      console.log('Invalid tokens:', invalidTokens);
    }

    if (validTokens.length === 0) {
      res.status(400).json({
        error: 'No valid Expo push tokens provided',
        invalidTokens
      });
      return;
    }

    // Create messages
    const messages = validTokens.map(token => ({
      to: token,
      sound: 'default',
      title: title,
      body: body,
      data: data || {},
    }));

    console.log('Sending messages to tokens:', validTokens.length);

    // Send messages
    const chunks = expo.chunkPushNotifications(messages);
    const tickets = [];

    for (const chunk of chunks) {
      try {
        const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
        tickets.push(...ticketChunk);
      } catch (error) {
        console.error('Error sending chunk:', error);
        tickets.push(...chunk.map(() => ({ error })));
      }
    }

    // Check for errors
    const errors = tickets
      .map((ticket, index) => {
        if (ticket.error) {
          return {
            token: validTokens[index],
            error: ticket.error
          };
        }
        return null;
      })
      .filter(Boolean);

    console.log('Push notification results:', {
      total: tickets.length,
      errors: errors.length,
      errors
    });

    res.status(200).json({
      success: true,
      message: 'Push notifications sent',
      userId,
      title,
      body,
      totalTokens: tokens.length,
      validTokens: validTokens.length,
      invalidTokens: invalidTokens.length,
      tickets: tickets.length,
      errors: errors.length,
      errorDetails: errors
    });

  } catch (error) {
    console.error('Error in push notification handler:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Push notification server is running' });
});

// Debug endpoint to test run reminder logic
app.get('/api/debug/run-reminders', async (req, res) => {
  try {
    const now = new Date();
    const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
    const twoHoursFromNow = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    
    const timeFilter = `start_time >= '${oneHourFromNow.toISOString()}' AND start_time < '${twoHoursFromNow.toISOString()}'`;
    
    console.log('Debug - Current time:', now.toISOString());
    console.log('Debug - One hour from now:', oneHourFromNow.toISOString());
    console.log('Debug - Two hours from now:', twoHoursFromNow.toISOString());
    console.log('Debug - Time filter:', timeFilter);
    
    // Get all runs that match the time criteria
    const { data: runs, error: runsError } = await supabase
      .from('runs')
      .select(`
        id,
        title,
        run_date,
        start_time
      `)
      .filter(timeFilter);
    
    if (runsError) {
      console.error('Debug - Error fetching runs:', runsError);
      return res.status(500).json({ error: runsError });
    }
    
    console.log('Debug - Found runs:', runs);
    
    // For each run, check attendees
    const runDetails = [];
    for (const run of runs) {
      const { data: attendees, error: attendeesError } = await supabase
        .from('run_attendees')
        .select('user_id')
        .eq('run_id', run.id);
      
      if (attendeesError) {
        console.error('Debug - Error fetching attendees for run', run.id, ':', attendeesError);
        continue;
      }
      
      // Get push tokens for attendees
      const userIds = attendees.map(a => a.user_id);
      const { data: tokens, error: tokensError } = await supabase
        .from('device_push_tokens')
        .select('user_id, token')
        .in('user_id', userIds);
      
      if (tokensError) {
        console.error('Debug - Error fetching tokens:', tokensError);
        continue;
      }
      
      runDetails.push({
        run: run,
        attendees: attendees,
        tokens: tokens
      });
    }
    
    res.json({
      currentTime: now.toISOString(),
      oneHourFromNow: oneHourFromNow.toISOString(),
      twoHoursFromNow: twoHoursFromNow.toISOString(),
      timeFilter: timeFilter,
      runsFound: runs.length,
      runs: runs,
      runDetails: runDetails
    });
    
  } catch (error) {
    console.error('Debug - Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Push notification server running at http://localhost:${port}`);
  console.log(`Test endpoint: http://localhost:${port}/api/send-push`);
  console.log(`Follow endpoint: http://localhost:${port}/api/follow`);
  console.log(`Unfollow endpoint: http://localhost:${port}/api/unfollow`);
}); 