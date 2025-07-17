const express = require('express');
const { Expo } = require('expo-server-sdk');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3001;

// Initialize Expo SDK
const expo = new Expo();

// Middleware
app.use(cors());
app.use(express.json());

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
}); 