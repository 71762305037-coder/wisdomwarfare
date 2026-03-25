# Environment Setup Guide

## Quick Start

```bash
# 1. Copy the example file
cp .env.example .env

# 2. Edit .env with your actual values
nano .env  # or use your favorite editor

# 3. Start the server
npm start
```

## Required Environment Variables

Only the following environment variables should be used:

```env
# Server Configuration
NODE_ENV=development|production
PORT=4001
SERVER_BASE=http://localhost:4001
FRONTEND_BASE=http://localhost:3000
CLIENT_BASE_URL=http://localhost:3000

# Database Configuration
DATABASE_URL=

# Email Configuration (Brevo) - Choose either Brevo or SMTP
BREVO_API_KEY=
BREVO_SENDER_EMAIL=
BREVO_SENDER_NAME=
EMAIL_FROM=

# Email Configuration (SMTP) - Alternative to Brevo
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
SMTP_SECURE=
```

---

## Configuration by Environment

### Local Development

```env
# .env (local development)
NODE_ENV=development
PORT=4001
SERVER_BASE=http://localhost:4001
FRONTEND_BASE=http://localhost:3000
CLIENT_BASE_URL=http://localhost:3000

# Database (local MySQL)
DATABASE_URL=

# Email (optional - won't send real emails in dev)
BREVO_API_KEY=
BREVO_SENDER_EMAIL=
BREVO_SENDER_NAME=
EMAIL_FROM=
```

**Start:**
```bash
npm run dev  # with auto-reload
# or
npm start
```

---

### Production (Render)

```env
# .env (Render deployment)
NODE_ENV=production
# Leave PORT empty - Render assigns it automatically
PORT=

SERVER_BASE=https://your-app-name.onrender.com
FRONTEND_BASE=https://your-frontend.vercel.app
CLIENT_BASE_URL=https://your-frontend.vercel.app

# Database - Use full URL from Render's MySQL service
DATABASE_URL=mysql://username:password@host.render.com:3306/wisdomwarfare

# Email (required for production)
BREVO_API_KEY=your_actual_api_key_here
BREVO_SENDER_EMAIL=noreply@yourdomain.com
BREVO_SENDER_NAME=Wisdom Warfare
EMAIL_FROM=noreply@yourdomain.com
```

**Deploy:**
```bash
git add .
git commit -m "Configure for Render"
git push origin main
# Render will automatically build and deploy
```

---

### Docker Deployment

```env
# .env (Docker)
NODE_ENV=production
PORT=4001
SERVER_BASE=http://your-domain.com
FRONTEND_BASE=https://your-frontend.com
CLIENT_BASE_URL=https://your-frontend.com

# Database - Use Docker service name
DATABASE_URL=mysql://root:password@mysql:3306/wisdomwarfare

# Email
BREVO_API_KEY=your_api_key
BREVO_SENDER_EMAIL=noreply@example.com
BREVO_SENDER_NAME=Wisdom Warfare
EMAIL_FROM=noreply@example.com
```

**Docker Compose:**
```yaml
version: '3.8'
services:
  backend:
    image: node:18
    ports:
      - "4001:4001"
    environment:
      NODE_ENV: production
      PORT: 4001
      DATABASE_URL: mysql://root:password@mysql:3306/wisdomwarfare
      SERVER_BASE: http://your-domain.com
      FRONTEND_BASE: https://your-frontend.com
      CLIENT_BASE_URL: https://your-frontend.com
      BREVO_API_KEY: your_api_key
      BREVO_SENDER_EMAIL: noreply@example.com
      BREVO_SENDER_NAME: Wisdom Warfare
      EMAIL_FROM: noreply@example.com
    depends_on:
      - mysql
  
  mysql:
    image: mysql:8
    environment:
      MYSQL_ROOT_PASSWORD: password
      MYSQL_DATABASE: wisdomwarfare
```

---

## Environment Variable Explanation

### Server Configuration

| Variable | Purpose | Example |
|----------|---------|---------|
| **NODE_ENV** | Environment mode | `development` or `production` |
| **PORT** | Server port (quiz & crossword) | `4001` |
| **SERVER_BASE** | Server URL for links/redirects | `http://localhost:4001` |
| **FRONTEND_BASE** | Frontend base URL | `http://localhost:3000` |
| **CLIENT_BASE_URL** | Client base URL | `http://localhost:3000` |

### Database Configuration

| Variable | Purpose | Example |
|----------|---------|---------|
| **DATABASE_URL** | Complete database connection URL (Recommended) | `mysql://user:pass@host:3306/db` |

**Notes:**
- Use `DATABASE_URL` for all production and cloud deployments
- Individual database parameters (DB_HOST, DB_USER, etc.) are not needed with DATABASE_URL
- DATABASE_URL format: `mysql://[username]:[password]@[host]:[port]/[database]`

### Email Configuration

**Option 1: Brevo (Recommended for most users)**

| Variable | Purpose | Example |
|----------|---------|---------|
| **BREVO_API_KEY** | Brevo API key | `xkeysib_1234567890abcd...` |
| **BREVO_SENDER_EMAIL** | Sender email address | `noreply@yourdomain.com` |
| **BREVO_SENDER_NAME** | Sender display name | `Wisdom Warfare` |
| **EMAIL_FROM** | From header email | `noreply@yourdomain.com` |

**Option 2: SMTP (Alternative)**

| Variable | Purpose | Example |
|----------|---------|---------|
| **SMTP_HOST** | SMTP server hostname | `smtp.gmail.com` |
| **SMTP_PORT** | SMTP server port | `587` or `465` |
| **SMTP_USER** | SMTP username | `your-email@gmail.com` |
| **SMTP_PASS** | SMTP password | `app-specific-password` |
| **SMTP_SECURE** | Use TLS/SSL | `true` or `false` |

**Choose ONE option:** Use either Brevo or SMTP, not both. If both are configured, Brevo will be used.

---

## Setting Up Email Services

### For Brevo (Recommended)

1. **Create Account:** https://dashboard.brevo.com/account/login
2. **Verify Sender Email:**
   - Go to Sending > Senders
   - Add your sender email and verify
3. **Get API Key:**
   - Go to Account > API Keys
   - Create new API key (give it a name like "Wisdom Warfare")
   - Copy the key
4. **Set in .env:**
   ```env
   BREVO_API_KEY=xkeysib_1234567890abcdef...
   BREVO_SENDER_EMAIL=noreply@yourdomain.com
   BREVO_SENDER_NAME=Wisdom Warfare
   EMAIL_FROM=noreply@yourdomain.com
   ```

### For Gmail SMTP

1. **Enable 2-Factor Authentication** (if not already enabled)
2. **Create App Password:**
   - Go to https://myaccount.google.com/apppasswords
   - Select "Mail" and "Windows Computer"
   - Copy the generated password
3. **Set in .env:**
   ```env
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=your-email@gmail.com
   SMTP_PASS=xxxx xxxx xxxx xxxx
   SMTP_SECURE=true
   ```

---

## Render Deployment Setup

### 1. Create Render Account
- Go to https://render.com
- Sign up with GitHub

### 2. Connect Database
- Create a new MySQL database on Render
- Note the `DATABASE_URL` provided

### 3. Create Web Service
- New → Web Service
- Connect to your GitHub repository
- Build command: `npm install`
- Start command: `npm start`

### 4. Set Environment Variables
In Render Dashboard → Environment:

```
NODE_ENV=production
PORT=
SERVER_BASE=https://your-app.onrender.com
FRONTEND_BASE=https://your-frontend.vercel.app
CLIENT_BASE_URL=https://your-frontend.vercel.app
DATABASE_URL=mysql://user:pass@host/db
BREVO_API_KEY=your_key
BREVO_SENDER_EMAIL=noreply@yourdomain.com
BREVO_SENDER_NAME=Wisdom Warfare
EMAIL_FROM=noreply@yourdomain.com
```

### 5. Deploy
- Click "Deploy"
- Render automatically:
  - Installs dependencies
  - Starts the server
  - Assigns a URL like `https://your-app.onrender.com`

---

## Important Notes

1. **Single Server for Both Games:** Both quiz and crossword games run on the same PORT. No separate CROSSWORD_PORT is needed.

2. **API Base URL:** The frontend should use `REACT_APP_API_BASE` for all API calls (both quiz and crossword endpoints).

3. **Database Configuration:** When using DATABASE_URL, ALL database requests go through this single URL. Individual database variables are not used.

4. **Email Configuration:** Use EITHER Brevo OR SMTP, not both. If both are configured, Brevo takes precedence.

5. **Production Deployment:** Always set NODE_ENV=production in production environments.

---

## Troubleshooting

### Error: "Cannot connect to database"
**Solution:**
1. Check DATABASE_URL is correctly formatted: `mysql://user:pass@host:3306/dbname`
2. Test the connection: `mysql -h host -u user -p password`
3. For Render deployments, verify DATABASE_URL is set in Environment variables

### Error: "Email sending failed"
**Solution:**
1. Verify BREVO_API_KEY is set and valid
2. OR verify SMTP credentials (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS)
3. Test locally with a curl command:
```bash
curl -X POST http://localhost:4001/api/send-email \
  -H "Content-Type: application/json" \
  -d '{"recipients": ["test@example.com"]}'
```

### Error: "Port already in use"
**Solution:**
```bash
# Windows: Find process using port 4001
netstat -ano | findstr :4001

# Kill the process (replace PID with the actual process ID)
taskkill /PID <PID> /F

# OR change port in .env
PORT=5000
```

### Error: "REACT_APP_API_BASE or REACT_APP_CROSSWORD_API_BASE not set"
**Solution:**
1. In your `.env.local` or `.env` file (frontend):
```env
REACT_APP_API_BASE=http://localhost:4001
```
2. No need for separate REACT_APP_CROSSWORD_API_BASE - use REACT_APP_API_BASE for both quiz and crossword endpoints
```

### Error: "Variable undefined in Render"
```bash
# Verify in Render dashboard:
# 1. Go to Settings → Environment
# 2. Check all variables are listed
# 3. Restart the service (Redeploy)
```

---

## Security Best Practices

### ✅ DO:
- Use strong passwords (minimum 16 characters)
- Use app-specific passwords for email services
- Rotate API keys regularly
- Use HTTPS in production (`https://`, not `http://`)
- Keep `.env` file in `.gitignore`
- Use different values for dev/production

### ❌ DON'T:
- Commit `.env` file to git
- Use account passwords in SMTP (use app-specific)
- Share API keys in messages/emails
- Use localhost in production URLs
- Hard-code credentials in code

---

## Verifying Your Setup

```bash
# 1. Start server
npm start

# 2. Check health endpoint
curl http://localhost:4001/

# 3. Test database connection
curl http://localhost:4001/test-db

# 4. Expected output:
# {
#   "message": "Wisdom Warfare Backend Running!",
#   "status": "healthy",
#   "database": "Connected ✅"
# }
```

If you see errors, check:
1. DATABASE_URL or DB_HOST/USER/PASSWORD
2. MySQL service is running
3. Database `wisdomwarfare` exists
4. Port 4001 is available

---

## Next Steps

1. ✅ Copy `.env.example` to `.env`
2. ✅ Fill in your database credentials
3. ✅ Configure email service of choice
4. ✅ Run `npm start` to verify
5. ✅ Deploy to Render or your hosting platform
