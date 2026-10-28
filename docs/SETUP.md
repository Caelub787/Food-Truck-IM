# Setting up TruckStock (free)

This gets the app live on free plans. It takes about 45 minutes the first time. You only do it once.

You'll make three free accounts: Supabase (database and logins), Cloudflare (hosts the app), and a Gmail account just for the app (sends emails). No credit card needed.

Screens in these services change now and then. If a button has a slightly different name, look for the closest match.

Keep a note open while you work. You'll copy a few values into it as you go:

| Name | Where it comes from |
|---|---|
| Database password | Step 1 |
| Project URL | Step 1 |
| Publishable key | Step 1 |
| Project ID (ref) | Step 1 |
| Access token | Step 1 |
| Gmail address | Step 2 |
| Gmail app password | Step 2 |
| App address | Step 3 |
| Cron secret | Step 4 (you make it up) |

## Step 1: Supabase

1. Go to supabase.com and sign up (signing in with GitHub is easiest).
2. Create a new project. Name it `TruckStock`. Pick a strong database password and save it in your note. Pick the region closest to you. Keep the Free plan.
3. When the project is ready, open **Project Settings**:
   * **Data API** (or **API**): copy the **Project URL**, like `https://abcd1234.supabase.co`. The part before `.supabase.co` (`abcd1234`) is your **Project ID**.
   * **API Keys**: copy the **publishable** key (it may be called the **anon public** key). This one is safe to put in the app.
   * Never copy the **secret** or **service_role** key anywhere. The app doesn't need it from you.
4. Make an access token so GitHub can update your database: click your profile picture, then **Account preferences**, then **Access Tokens**, then **Generate new token**. Name it `GitHub deploy` and save it in your note.

## Step 2: A Gmail account for the app

1. Make a new Gmail account just for the app, like `truckstockapp@gmail.com`. Emails from the app will come from this address.
2. In that account, go to myaccount.google.com, then **Security**, and turn on **2 Step Verification**.
3. Then search the account settings for **App passwords**. Create one called `TruckStock`. Google shows a 16 letter password once. Save it in your note (no spaces).

## Step 3: Cloudflare (hosts the app)

1. Go to cloudflare.com and sign up.
2. Go to **Workers & Pages**, then **Create**. Pick the option to import from Git (Pages: **Connect to Git**). Connect your GitHub account and pick the `Food-Truck-IM` repository.
3. Settings:
   * Branch: the branch with the app on it (right now `ccr-ee84e127-hvai58`, later `main`)
   * Build command: `npm run build`
   * Output folder: `dist` (if asked for a deploy command instead, use `npx wrangler deploy`)
4. Add two environment variables (build variables):
   * `VITE_SUPABASE_URL` = your Project URL
   * `VITE_SUPABASE_PUBLISHABLE_KEY` = your publishable key
5. Deploy. Cloudflare gives you an address like `https://truckstock.pages.dev`. That's your **App address**. Save it.

From now on, every time new code is pushed, Cloudflare rebuilds the app on its own.

## Step 4: Supabase login settings

In your Supabase project:

1. **Authentication**, then **URL Configuration**:
   * **Site URL**: your App address
   * **Redirect URLs**: add your App address followed by `/**` (like `https://truckstock.pages.dev/**`)
2. **Authentication**, then **Sign In / Providers** (or **Providers**), then **Email**:
   * **Confirm email**: on
   * **Email OTP Expiration**: `86400` (that's 24 hours, so invite links don't expire too fast)
3. **Authentication**, then **Emails**, then **SMTP Settings**: turn on custom SMTP.
   * Sender email: your Gmail address
   * Sender name: `TruckStock`
   * Host: `smtp.gmail.com`
   * Port: `465`
   * Username: your Gmail address
   * Password: your Gmail app password
4. **Authentication**, then **Emails**, then **Templates**. For each one below, open the file from this repository, copy everything in it, and paste it over the template's message. Also set the subject.

   | Template | File | Subject |
   |---|---|---|
   | Confirm signup | `supabase/templates/confirmation.html` | Confirm your email |
   | Invite user | `supabase/templates/invite.html` | You're invited |
   | Reset password | `supabase/templates/recovery.html` | Reset your password |
   | Change email address | `supabase/templates/email_change.html` | Confirm your new email |

5. **Edge Functions**, then **Secrets** (or **Manage secrets**). Add these:

   | Name | Value |
   |---|---|
   | `SITE_URL` | your App address |
   | `EMAIL_FROM` | `TruckStock <your Gmail address>` |
   | `SMTP_USER` | your Gmail address |
   | `SMTP_PASS` | your Gmail app password |
   | `CRON_SECRET` | make up a long random password (at least 30 letters and numbers) and save it in your note |

## Step 5: Let GitHub update Supabase

1. On GitHub, open the repository, then **Settings**, then **Secrets and variables**, then **Actions**, then **New repository secret**. Add three:

   | Name | Value |
   |---|---|
   | `SUPABASE_ACCESS_TOKEN` | your access token |
   | `SUPABASE_PROJECT_REF` | your Project ID |
   | `SUPABASE_DB_PASSWORD` | your database password |

2. Open the **Actions** tab, pick **Deploy database and server functions**, and press **Run workflow**. Wait for the green check (a couple of minutes). This builds all the tables and security rules and uploads the server functions.

## Step 6: Two quick SQL steps

In Supabase, open **SQL Editor**, then **New query**.

1. Make yourself the App Owner. Open `supabase/setup/1-app-owner.sql`, copy it in, change `you@example.com` to the email you'll sign up with, and press **Run**.
2. Turn on the email timer. Open `supabase/setup/2-email-timer.sql`, copy it in, put in your Project URL and your cron secret where it says, and press **Run**.

## Step 7: Sign up

1. Open your App address on your phone.
2. Tap **Sign up your business** and use the App Owner email.
3. Confirm your email from the link you get.
4. You're approved right away (App Owners are), and you'll see the **Owner** tab.
5. On your phone, add the app to your home screen (Safari: Share, then **Add to Home Screen**. Chrome: menu, then **Install app**).

When other businesses sign up, you get an email and they show up in the Owner tab for you to approve.

## If something doesn't work

* **No emails arrive**: check the spam folder. Check the Gmail app password and that SMTP is turned on in Step 4. In Supabase, **Table Editor**, then the `outbox` table shows each email and any error.
* **"That link didn't work"**: links work once and for 24 hours. Send a new invite from the People screen.
* **The app says it isn't connected**: the two Cloudflare variables in Step 3 are missing or have a typo. Fix them and redeploy.
* **The project is paused**: free Supabase projects pause after 7 days with nobody using them. Open the project in Supabase and press **Restore**. Nothing is lost.

## When you outgrow the free plans

* Supabase Pro ($25 a month) gives 8 GB of database space, daily backups, and no pausing. Upgrading is one button in Supabase. Nothing in the app changes.
* With your own domain, switch email from Gmail to Resend or Brevo for better delivery. Change the Edge Function secrets (`EMAIL_PROVIDER`, `EMAIL_FROM`, and the provider's API key) and the Supabase SMTP settings. No code changes.
