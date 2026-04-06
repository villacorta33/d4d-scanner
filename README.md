# D4D Batch Scanner — Railway Deployment

## Setup Instructions

### Step 1 — Get a Google Service Account (for writing to Sheets)

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Select your project (same one with your Maps API key)
3. Go to **IAM & Admin → Service Accounts**
4. Click **Create Service Account**
   - Name: `d4d-scanner`
   - Click Create and Continue → Done
5. Click the service account you just created
6. Go to **Keys** tab → **Add Key → Create new key → JSON**
7. Download the JSON file — keep it safe
8. Go to **APIs & Services → Enable APIs**
   - Enable **Google Sheets API**
   - Enable **Google Drive API**

### Step 2 — Deploy to Railway

1. Push this repo to GitHub
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Select this repo
4. Railway will auto-detect Node.js and deploy

### Step 3 — Set Environment Variables in Railway

In your Railway project → Variables tab, add:

```
GOOGLE_SERVICE_ACCOUNT_JSON = <paste entire contents of your service account JSON file>
SMTP_USER = your-gmail@gmail.com  (optional, for email notifications)
SMTP_PASS = your-app-password      (optional, Gmail app password)
```

Note: GMAPS_KEY and CLAUDE_KEY are entered in the app UI and stored in the browser — no need to set them as env vars unless you want them pre-filled.

### Step 4 — Use the App

1. Open your Railway app URL
2. Enter your Google Maps API key and Anthropic API key
3. Upload your CSV directly — any size works
4. Map columns, set options, click Start

## Architecture

- **Frontend**: Single HTML file served by Express
- **Backend**: Node.js + Express on Railway
- **AI**: Claude Haiku 4.5 Batch API
- **Images**: Google Street View Static API + Maps Static API (satellite)
- **Output**: Google Sheets via Service Account

## Cost

- Railway: ~$5-10/month (Hobby plan)
- Street View: $7/1,000 images
- Satellite: $2/1,000 images  
- Claude Haiku 4.5 batch: ~$0.00044/property
