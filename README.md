# Push Notification Server

A Node.js server for sending push notifications via Expo's push notification service.

## Features

- Send push notifications to multiple devices
- Validate Expo push tokens
- Handle chunked notifications for large token lists
- CORS enabled for cross-origin requests
- Health check endpoint

## API Endpoints

### POST /api/send-push

Send push notifications to devices.

**Request Body:**
```json
{
  "userId": "user-uuid",
  "title": "Notification Title",
  "body": "Notification Body",
  "data": { "custom": "data" },
  "tokens": ["ExponentPushToken[...]"]
}
```

**Response:**
```json
{
  "success": true,
  "message": "Push notifications sent",
  "userId": "user-uuid",
  "title": "Notification Title",
  "body": "Notification Body",
  "totalTokens": 1,
  "validTokens": 1,
  "invalidTokens": 0,
  "tickets": 1,
  "errors": 0,
  "errorDetails": []
}
```

### GET /health

Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "message": "Push notification server is running"
}
```

## Environment Variables

- `PORT` - Server port (default: 3001)
- `EXPO_ACCESS_TOKEN` - Expo access token for production (optional)

## Deployment

This server is designed to be deployed on Railway. 