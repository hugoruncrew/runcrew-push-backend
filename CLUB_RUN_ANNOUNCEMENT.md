# Club Run Announcement Endpoint

## Overview

Added a new endpoint `/api/club-run-announcement` to handle push notifications when clubs add new runs. This endpoint follows the same pattern as the existing follow notification system.

## Endpoint Details

### POST /api/club-run-announcement

Sends push notifications to all followers of a club when a new run is created.

**Request Body:**
```json
{
  "run_id": "uuid",
  "club_id": "uuid", 
  "created_by": "uuid"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Club run announcement sent",
  "run_id": "uuid",
  "club_id": "uuid",
  "followers_count": 15,
  "notifications_created": 15,
  "push_notifications_sent": 3
}
```

## Features

1. **Public Run Filtering**: Only sends notifications for public runs
2. **User Preference Respect**: Checks `club_run_announcements_enabled` preference in notification_preferences table
3. **Database Notifications**: Creates notification records in the notifications table
4. **Push Notifications**: Sends push notifications via Expo SDK to users with device tokens
5. **Comprehensive Logging**: Detailed logging for debugging and monitoring
6. **Idempotency**: Prevents duplicate notifications for the same run

## Implementation Details

- **Consistent with Follow Notifications**: Uses the same pattern and Expo SDK
- **Error Handling**: Comprehensive error handling with appropriate HTTP status codes
- **Validation**: Validates UUID format and required fields
- **Performance**: Efficient database queries with proper indexing
- **Duplicate Prevention**: Checks for existing notifications before creating new ones

## Usage

The endpoint should be called after a new run is successfully created in the database. The frontend should make a POST request to this endpoint with the run details.

## Database Requirements

- `runs` table with columns: id, title, run_date, location, start_time, is_public, club_id, created_by
- `user_club_follows` table with columns: user_id, club_id
- `notification_preferences` table with column: club_run_announcements_enabled
- `notifications` table for storing notification records
- `device_push_tokens` table for storing user device tokens
