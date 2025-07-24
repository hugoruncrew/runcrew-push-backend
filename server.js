const express = require('express');
const { Expo } = require('expo-server-sdk');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');
const { sendRunReminders } = require('./run-reminders');
const waitlistSignup = require('./api/waitlist-signup');

const app = express();
const port = process.env.PORT || 3001;

// Initialize Expo SDK
const expo = new Expo();

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL || 'https://ujmbtqyqwiqfblnerahv.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'sbp_a2b8ff89eacce00aa38f49836a7176337969eb9b';
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Middleware
app.use(cors());
app.use(express.json());
app.use('/api', waitlistSignup);

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    message: "Push notification server is running",
    timestamp: new Date().toISOString()
  });
});

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

    // 1. Insert follow relationship (this is the critical operation)
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

    // 2. Start notification process in parallel (don't wait for it)
    const notificationPromise = (async () => {
      try {
        // Get follower's profile info and push tokens in parallel
        const [profileResult, tokensResult] = await Promise.all([
          supabase
            .from('profiles')
            .select('username, first_name, last_name, avatar_url')
            .eq('id', follower_id)
            .single(),
          supabase
            .from('device_push_tokens')
            .select('token')
            .eq('user_id', following_id)
        ]);

        const followerProfile = profileResult.data;
        const tokens = tokensResult.data;

        if (profileResult.error) {
          console.error('Error fetching follower profile:', profileResult.error);
        }

        if (tokensResult.error) {
          console.error('Error fetching push tokens:', tokensResult.error);
        }

        // Send push notification if tokens exist
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

        // Insert notification record
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
      } catch (error) {
        console.error('Error in notification process:', error);
      }
    })();

    // Return success immediately after follow relationship is created
    // Don't wait for notification process to complete
    res.json({
      success: true,
      message: 'Follow relationship created',
      follower_id,
      following_id
    });

    // Let notification process continue in background
    notificationPromise.catch(error => {
      console.error('Background notification process failed:', error);
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

// Complete run endpoint with push notifications
app.post('/api/complete-run', async (req, res) => {
  try {
    const { run_id, host_id } = req.body;

    console.log('Complete run request:', { run_id, host_id });

    // Validate required fields
    if (!run_id || !host_id) {
      return res.status(400).json({
        error: 'Missing required fields: run_id, host_id'
      });
    }

    // 1. Verify the host is authorized (check if they are the host of the run)
    const { data: runData, error: runError } = await supabase
      .from('runs')
      .select('id, title, created_by')
      .eq('id', run_id)
      .single();

    if (runError || !runData) {
      console.error('Error fetching run data:', runError);
      return res.status(404).json({
        error: 'Run not found',
        details: runError?.message
      });
    }

    if (runData.created_by !== host_id) {
      return res.status(403).json({
        error: 'Unauthorized: Only the host can complete the run'
      });
    }

    // 2. Get all checked-in, not yet completed attendees
    const { data: attendees, error: attendeesError } = await supabase
      .from('run_attendees')
      .select('user_id')
      .eq('run_id', run_id)
      .eq('checked_in', true)
      .eq('completed', false);

    if (attendeesError) {
      console.error('Error fetching attendees:', attendeesError);
      return res.status(400).json({
        error: 'Failed to fetch attendees',
        details: attendeesError.message
      });
    }

    if (!attendees || attendees.length === 0) {
      return res.json({
        success: true,
        message: 'No checked-in attendees to mark as completed',
        run_id,
        attendees_completed: 0,
        notifications_sent: 0
      });
    }

    const userIds = attendees.map(a => a.user_id);
    console.log(`Found ${userIds.length} attendees to mark as completed`);

    // 3. Mark all as completed
    const { error: updateError } = await supabase
      .from('run_attendees')
      .update({ completed: true })
      .eq('run_id', run_id)
      .in('user_id', userIds)
      .eq('checked_in', true)
      .eq('completed', false);

    if (updateError) {
      console.error('Error updating attendees:', updateError);
      return res.status(400).json({
        error: 'Failed to mark attendees as completed',
        details: updateError.message
      });
    }

    // 4. Send push notifications to each completed attendee
    let notificationsSent = 0;
    const notificationErrors = [];

    for (const userId of userIds) {
      try {
        // Get device push tokens for the user
        const { data: tokens, error: tokenError } = await supabase
          .from('device_push_tokens')
          .select('token')
          .eq('user_id', userId);

        if (tokenError) {
          console.error('Error fetching tokens for user', userId, tokenError);
          continue;
        }

        if (!tokens || tokens.length === 0) {
          console.log(`No push tokens for user ${userId}`);
          continue;
        }

        const validTokens = tokens
          .map(t => t.token)
          .filter(token => Expo.isExpoPushToken(token));

        if (validTokens.length === 0) {
          console.log(`No valid Expo tokens for user ${userId}`);
          continue;
        }

        // Create notification messages
        const messages = validTokens.map(token => ({
          to: token,
          sound: 'default',
          title: '🎉 Run Completed!',
          body: `Congrats on completing ${runData.title || 'the run'}!`,
          data: {
            type: 'run_completed',
            runId: run_id,
            screen: 'Activity'
          }
        }));

        console.log(`Sending run completion notification to user ${userId} with ${validTokens.length} tokens`);

        // Send messages in chunks
        const chunks = expo.chunkPushNotifications(messages);
        const tickets = [];

        for (const chunk of chunks) {
          try {
            const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
            tickets.push(...ticketChunk);
          } catch (error) {
            console.error('Error sending notification chunk:', error);
            notificationErrors.push({ userId, error: error.message });
          }
        }

        // Log results
        const errors = tickets.filter(ticket => ticket.error);
        if (errors.length > 0) {
          console.error('Notification errors for user', userId, errors);
          notificationErrors.push({ userId, errors });
        } else {
          notificationsSent++;
        }

      } catch (error) {
        console.error('Error processing notifications for user', userId, error);
        notificationErrors.push({ userId, error: error.message });
      }
    }

    res.json({
      success: true,
      message: 'Run completed successfully',
      run_id,
      run_title: runData.title,
      attendees_completed: userIds.length,
      notifications_sent: notificationsSent,
      notification_errors: notificationErrors.length,
      errors: notificationErrors
    });

  } catch (error) {
    console.error('Error in complete run handler:', error);
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


// Club run announcement endpoint with push notification
app.post("/api/club-run-announcement", async (req, res) => {
  try {
    const { run_id, club_id, created_by } = req.body;

    console.log("Club run announcement request:", { run_id, club_id, created_by });

    // Validate required fields
    if (!run_id || !club_id || !created_by) {
      return res.status(400).json({
        error: "Missing required fields: run_id, club_id, created_by"
      });
    }

    // 1. Get run details
    const { data: runData, error: runError } = await supabase
      .from("runs")
      .select("title, run_date, location, start_time, is_public")
      .eq("id", run_id)
      .single();

    if (runError || !runData) {
      console.error("Error fetching run data:", runError);
      return res.status(400).json({
        error: "Failed to fetch run data",
        details: runError?.message
      });
    }

    // Only send notifications for public runs
    if (!runData.is_public) {
      return res.json({
        success: true,
        message: "Run is not public, no notifications sent",
        run_id,
        club_id
      });
    }

    // 2. Get club details
    const { data: clubData, error: clubError } = await supabase
      .from("clubs")
      .select("name")
      .eq("id", club_id)
      .single();

    if (clubError) {
      console.error("Error fetching club data:", clubError);
    }

    const clubName = clubData?.name || "A club";

    // 3. Get all club followers
    const { data: followers, error: followersError } = await supabase
      .from("user_club_follows")
      .select("user_id")
      .eq("club_id", club_id);

    if (followersError) {
      console.error("Error fetching club followers:", followersError);
      return res.status(400).json({
        error: "Failed to fetch club followers",
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
        .from("notification_preferences")
        .select("club_run_announcements")
        .eq("user_id", follower.user_id)
        .single();

      // Default to true if no preference is set
      const shouldNotify = preferences?.club_run_announcements !== false;

      if (!shouldNotify) {
        console.log(`Skipping notification for user ${follower.user_id} - club_run_announcements disabled`);
        continue;
      }

      // 5. Insert notification record
      // Check if notification already exists for this run and user
      const { data: existingNotification, error: existingError } = await supabase
        .from("notifications")
        .select("id")
        .eq("user_id", follower.user_id)
        .eq("type", "club_run_announcement")
        .eq("payload->run_id", run_id)
        .single();

      if (existingNotification) {
        console.log(`Notification already exists for user ${follower.user_id} and run ${run_id}, skipping`);
        continue;
      }
      try {
        await supabase
          .from("notifications")
          .insert({
            user_id: follower.user_id,
            type: "club_run_announcement",
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
        console.error("Error inserting notification record:", notifError);
      }

      // 6. Get device push tokens for the follower
      const { data: tokens, error: tokenError } = await supabase
        .from("device_push_tokens")
        .select("token")
        .eq("user_id", follower.user_id);

      if (tokenError) {
        console.error("Error fetching push tokens:", tokenError);
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
            sound: "default",
            title: "🏃‍♂️ New Run Available!",
            body: `${clubName} has added a new run: ${runData.title || "Untitled Run"}`,
            data: {
              type: "club_run_announcement",
              clubId: club_id,
              runId: run_id,
              screen: "Run",
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
              console.error("Error sending notification chunk:", error);
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

          console.log("Club run notification results:", {
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
      message: "Club run announcement sent",
      run_id,
      club_id,
      followers_count: followers.length,
      notifications_created: notificationCount,
      push_notifications_sent: pushNotificationCount
    });

  } catch (error) {
    console.error("Error in club run announcement handler:", error);
    res.status(500).json({
      error: "Internal server error",
      message: error.message
    });
  }
});
app.listen(port, () => {
  console.log(`Push notification server running at http://localhost:${port}`);
  console.log(`Test endpoint: http://localhost:${port}/api/send-push`);
  console.log(`Follow endpoint: http://localhost:${port}/api/follow`);
  console.log(`Unfollow endpoint: http://localhost:${port}/api/unfollow`);
  console.log(`Club run announcement endpoint: http://localhost:${port}/api/club-run-announcement`);
}); 