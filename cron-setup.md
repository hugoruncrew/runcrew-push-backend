# Run Reminder Cron Jobs Setup

This document explains how to set up automated run reminder notifications.

## Manual Testing

You can test the reminder system manually using these commands:

```bash
# Send day-before reminders
npm run reminders:day-before

# Send hour-before reminders  
npm run reminders:hour-before
```

## Automated Cron Jobs

To set up automated reminders, you'll need to configure cron jobs on your server.

### Option 1: Using Render Cron Jobs (Recommended)

If you're using Render, you can set up cron jobs in the Render dashboard:

1. Go to your service in Render dashboard
2. Navigate to "Cron Jobs" tab
3. Add two cron jobs:

**Day Before Reminders (Daily at 6 PM)**
- Command: `npm run reminders:day-before`
- Schedule: `0 18 * * *` (6 PM daily)

**Hour Before Reminders (Every hour)**
- Command: `npm run reminders:hour-before`  
- Schedule: `0 * * * *` (Every hour at minute 0)

### Option 2: Using System Cron

If you have server access, you can set up system cron jobs:

```bash
# Edit crontab
crontab -e

# Add these lines:
# Day before reminders at 6 PM daily
0 18 * * * cd /path/to/your/app && npm run reminders:day-before

# Hour before reminders every hour
0 * * * * cd /path/to/your/app && npm run reminders:hour-before
```

### Option 3: Using External Cron Services

You can also use external services like:
- **Cron-job.org**: Free web-based cron service
- **EasyCron**: Paid service with web interface
- **GitHub Actions**: If your code is on GitHub

## API Endpoints

You can also trigger reminders via HTTP requests:

```bash
# Day before reminders
curl -X POST https://your-backend-url.onrender.com/api/reminders/day-before

# Hour before reminders
curl -X POST https://your-backend-url.onrender.com/api/reminders/hour-before
```

## How It Works

1. **Day Before Reminders**: Runs daily at 6 PM, finds all runs happening tomorrow, and sends notifications to attendees
2. **Hour Before Reminders**: Runs every hour, finds runs starting in the next hour, and sends notifications

## Notification Content

- **Day Before**: "🏃‍♂️ Run Tomorrow! Don't forget: [Run Title] tomorrow at [Time]"
- **Hour Before**: "⏰ Run in 1 Hour! Your run "[Run Title]" starts in 1 hour"

## Tapping Notifications

When users tap run reminder notifications, they are taken directly to the run details screen where they can:
- View run information
- See other attendees
- Get directions
- Check in (if available) 