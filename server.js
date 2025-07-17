const express = require('express');
const { Expo } = require('expo-server-sdk');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');

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
      .select('username, first_name, last_name')
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
        const followerName = followerProfile?.username || 
                           `${followerProfile?.first_name || 'Someone'} ${followerProfile?.last_name || ''}`.trim() || 
                           'Someone';

        const messages = validTokens.map(token => ({
          to: token,
          sound: 'default',
          title: 'New Follower! 🎉',
          body: `${followerName} started following you`,
          data: {
            type: 'new_follower',
            follower_id: follower_id,
            screen: 'Runner',
            params: JSON.stringify({ runnerId: follower_id })
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
          type: 'new_follower',
          data: {
            follower_id: follower_id,
            follower_name: followerProfile?.username || 'Someone'
          }
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

app.listen(port, () => {
  console.log(`Push notification server running at http://localhost:${port}`);
  console.log(`Test endpoint: http://localhost:${port}/api/send-push`);
  console.log(`Follow endpoint: http://localhost:${port}/api/follow`);
  console.log(`Unfollow endpoint: http://localhost:${port}/api/unfollow`);
}); 