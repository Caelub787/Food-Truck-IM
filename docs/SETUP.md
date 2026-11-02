# Setting up Food Truck IM (free)

This puts Food Truck IM online on free plans. Plan on about an hour the first time. You only do it once. A computer is easier than a phone for this.

You'll use four free accounts. None of them need a credit card:

1. **GitHub** (you already have it): holds the app's code, updates the database, and makes weekly backups.
2. **Gmail**: a new Gmail account just for the app. It sends the app's emails.
3. **Supabase**: the database, logins, photos, live updates, and the server code.
4. **Cloudflare**: puts the app on the internet and gives you its address.

Screens in these services change now and then. If a button has a slightly different name, look for the closest match.

**Never paste any password, key, or token into a chat, an email, or the code.** Each one only goes in the spot this guide names.

## Your note

Open a note on your computer (a password manager is best) and keep these as you go:

| What | Where it comes from | Where it goes |
|---|---|---|
| Gmail address | Step 1 | Supabase |
| Gmail app password | Step 1 | Supabase |
| Database password | Step 2 | GitHub |
| Project URL | Step 2 | Cloudflare, SQL step |
| Publishable key | Step 2 | Cloudflare |
| Project ID | Step 2 | GitHub |
| Access token | Step 2 | GitHub |
| Backup passphrase | Step 3 (you make it up) | GitHub |
| App address | Step 4 | Supabase |
| Cron secret | Step 6 (you make it up) | Supabase, SQL step |
| Push keys | Step 9 (the app makes them) | Supabase, Cloudflare |

When this guide says "make up a long password", use only letters and numbers (no symbols), at least 30 of them. Your password manager's "generate password" button works if you turn symbols off.

## Step 1: A Gmail account for the app (10 minutes)

1. Go to **accounts.google.com/signup** and make a new Gmail account just for the app, like `foodtruckim@gmail.com` (pick whatever is free). The app's emails come from this address, so pick a name your people will recognize. Save the address in your note.
2. While logged in to that new account, go to **myaccount.google.com**, then **Security** (it may say **Security & sign in**).
3. Find **2 Step Verification** and turn it on. Google walks you through it with your phone number.
4. Now go to **myaccount.google.com/apppasswords**.
5. Under **App name**, type `Food Truck IM` and press **Create**.
6. Google shows a password of 16 letters in a yellow box. Copy it into your note **without the spaces**. Google only shows it once. Press **Done**.

If the App passwords page says the setting isn't available, 2 Step Verification isn't finished yet. Go back to Security and check it says On.

## Step 2: Supabase (10 minutes)

1. Go to **supabase.com** and press **Start your project**. Sign up with **Continue with GitHub** (easiest).
2. If it asks you to make an organization, name it anything (like your business name) and pick the **Free** plan.
3. Press **New project**:
   * **Project name**: `Food Truck IM`
   * **Database password**: press **Generate a password**, then copy it into your note as the Database password.
   * **Region**: the one closest to you.
   * Press **Create new project** and wait a minute or two while it sets up.
4. On the project's home page, find **Project URL** (or press **Connect** at the top of the page). It looks like `https://abcdefghijklmnop.supabase.co`. Copy it into your note.
5. Click the gear for **Project Settings** at the bottom of the left menu, then **General**. Copy the **Project ID** (it's the same letters as the start of your Project URL).
6. Still in Project Settings, click **API Keys**. Copy the **Publishable key** (it starts with `sb_publishable_`). Older projects call it the **anon public** key. This one is safe to put in the app.
   * Don't copy the **Secret key** or **service_role** key anywhere. The app gets it from Supabase on its own.
7. Make an access token so GitHub can update your database:
   1. Click your profile picture (top right), then **Account preferences**, then **Access Tokens**. (Or go straight to **supabase.com/dashboard/account/tokens**.)
   2. Press **Generate new token** and name it `GitHub deploy`.
   3. If it asks what the token can do, give it full access. If it shows a list instead, set everything to the most access it offers.
   4. Copy the token into your note. It's only shown once.

## Step 3: Let GitHub set up the database (10 minutes)

1. Open **github.com/Caelub787/Food-Truck-IM** and click **Settings** (the gear tab at the top of the repository).
2. In the left menu, under **Security**, click **Secrets and variables**, then **Actions**.
3. Press **New repository secret** and add these four, one at a time. For each one, type the **Name** exactly as shown, paste the value in **Secret**, and press **Add secret**:

   | Name | Secret |
   |---|---|
   | `SUPABASE_ACCESS_TOKEN` | your Access token |
   | `SUPABASE_PROJECT_REF` | your Project ID |
   | `SUPABASE_DB_PASSWORD` | your Database password |
   | `BACKUP_PASSPHRASE` | make up a long password and save it in your note. Weekly backups are locked with it. |

4. Click the **Actions** tab at the top of the repository. If GitHub asks you to turn workflows on, press the green button to allow them.
5. In the left list, click **Deploy database and server functions**.
6. On the right, press **Run workflow**. Leave the branch as it is (`ccr-ee84e127-hvai58`) and press the green **Run workflow** button.
7. Wait 2 to 4 minutes. Refresh the page. A green check means your database, its security rules, and the server code are all set up.

If you get a red X instead, click it, then click the red step to see what went wrong. Most of the time one of the four secrets has a typo or an extra space. Fix it (on the secrets page, click the pencil next to it) and run it again.

From now on, every time the app's database code changes on GitHub, this runs by itself.

## Step 4: Cloudflare (10 minutes)

1. Go to **dash.cloudflare.com/sign-up** and make an account. Confirm your email.
2. In the left menu, open **Compute & AI** or **Workers & Pages** (whichever you see), then **Workers & Pages**.
3. Press **Create application**. Cloudflare opens the Workers screen first. Look for the **Pages** tab (or a link like "Looking to deploy Pages? Get started") and click it.
4. Press **Connect to Git** (it may say **Import an existing Git repository**), pick **GitHub**, and press **Install & Authorize**. When GitHub asks which repositories, pick **Only select repositories**, choose `Food-Truck-IM`, and approve.
5. Back in Cloudflare, pick `Food-Truck-IM` and press **Begin setup**.
6. On **Set up builds and deployments**:
   * **Project name**: `foodtruckim`. This becomes your address, `https://foodtruckim.pages.dev`. If it's taken, Cloudflare tells you; add something like your town.
   * **Production branch**: `ccr-ee84e127-hvai58` (it's the only one).
   * **Framework preset**: None
   * **Build command**: `npm run build`
   * **Build output directory**: `dist`
   * Open **Environment variables (advanced)** and add two (press **Add variable** for each):

     | Variable name | Value |
     |---|---|
     | `VITE_SUPABASE_URL` | your Project URL |
     | `VITE_SUPABASE_PUBLISHABLE_KEY` | your Publishable key |

7. Press **Save and Deploy**. It takes 2 or 3 minutes. When it says it's done, press **Continue to project**.
8. Your app's address is shown at the top, like `https://foodtruckim.pages.dev`. That's your **App address**. Save it in your note. (If you open it now, it works, but logins won't email until Step 5 is done.)

From now on, every time new code goes up on GitHub, Cloudflare rebuilds the app on its own.

## Step 5: Supabase login and email settings (15 minutes)

All of this is in your Supabase project, in the left menu under **Authentication**.

1. **URL Configuration**:
   * **Site URL**: your App address. Press **Save**.
   * Under **Redirect URLs**, press **Add URL** and enter your App address followed by `/**`, like `https://foodtruckim.pages.dev/**`. Save.
2. **Sign In / Providers**, then click **Email**:
   * **Confirm email**: on.
   * **Email OTP Expiration**: `86400` (that's 24 hours, so invite and confirm links don't run out too fast).
   * Press **Save**.
3. **Emails**, then the **SMTP Settings** tab. Turn on **Enable custom SMTP** and fill in:
   * **Sender email address**: your Gmail address
   * **Sender name**: `Food Truck IM`
   * **Host**: `smtp.gmail.com`
   * **Port number**: `465`
   * **Username**: your Gmail address
   * **Password**: your Gmail app password
   * Press **Save changes**.
4. **Rate Limits**: find **Rate limit for sending emails** (it starts at 30 an hour) and change it to `100`. Save. Gmail allows about 500 emails a day, so don't go above that.
5. **Emails**, then the **Templates** tab. There are four to change. For each one:
   1. Open its file on GitHub (links below), and press the **Copy raw file** button (two squares, top right of the file).
   2. In Supabase, click the template, set the **Subject**, then select everything in the message box, delete it, and paste.
   3. Press **Save changes**.

   | Template | File on GitHub (in the `supabase/templates` folder) | Subject |
   |---|---|---|
   | Confirm sign up | `confirmation.html` | Confirm your email |
   | Invite user | `invite.html` | You're invited |
   | Reset password | `recovery.html` | Reset your password |
   | Change email address | `email_change.html` | Confirm your new email |

   To find the files: on **github.com/Caelub787/Food-Truck-IM**, click the `supabase` folder, then `templates`.

## Step 6: Supabase server settings (5 minutes)

1. In the left menu, click **Edge Functions**, then **Secrets**.
2. Add these five. For each, type the **Name**, paste the **Value**, and press **Save** (or add them all, then save):

   | Name | Value |
   |---|---|
   | `SITE_URL` | your App address |
   | `EMAIL_FROM` | `Food Truck IM <your Gmail address>`, like `Food Truck IM <foodtruckim@gmail.com>` |
   | `SMTP_USER` | your Gmail address |
   | `SMTP_PASS` | your Gmail app password |
   | `CRON_SECRET` | make up a long password (letters and numbers only) and save it in your note |

## Step 7: Three quick SQL steps (5 minutes)

In Supabase, click **SQL Editor** in the left menu. For each file below: open it on GitHub (in the `supabase/setup` folder), press **Copy raw file**, then in Supabase press **+** (new query), paste, make the change it asks for, and press **Run** (bottom right). It should say **Success**.

1. `1-app-owner.sql` makes you the App Owner. Change `you@example.com` to **your own email** (the one you'll log in with, not the app's Gmail). Keep the quote marks around it.
2. `2-email-timer.sql` makes emails go out every minute. Change `https://YOUR-PROJECT.supabase.co` to your Project URL and `PASTE-YOUR-CRON-SECRET` to your cron secret. Keep the quote marks.
3. `3-jobs-timer.sql` turns on reports, alerts, reminders, order lists, par suggestions, and photo cleanup. Nothing to change.

Only run each one once. If one says something "already exists", it was already done and you can move on.

## Step 8: Make your account

1. Open your App address on your phone.
2. Tap **Sign up your business**. Use the same email you put in `1-app-owner.sql`.
3. Open the email from Food Truck IM and tap the link to confirm (check spam the first time, and mark it "not spam").
4. Log in. App Owners are approved right away, and you'll see the **App owner** page (called **Owner** on phones, under **More** if it doesn't fit). That's where you approve other businesses that sign up.
5. Add the app to your home screen so it opens like a normal app:
   * iPhone (Safari): tap **Share**, then **Add to Home Screen**.
   * Android (Chrome): tap the menu (three dots), then **Install app** or **Add to Home screen**.
6. Set up your business: trucks, supplies (add pictures if you like), products, and people. The starter kits fill in a lot for you. See [GUIDE.md](GUIDE.md).

## Step 9: Push notifications (optional, 10 minutes)

Push notifications are the alerts that pop up on phones (low stock, reminders, order lists). Emails work without this step.

1. In the app, open the **App owner** page and scroll down to **Push notification keys**. Tap **Make push keys**. Keep that page open.
2. In Supabase, **Edge Functions**, then **Secrets**. Add three more:

   | Name | Value |
   |---|---|
   | `VAPID_PUBLIC_KEY` | the public key from the app |
   | `VAPID_PRIVATE_KEY` | the private key from the app |
   | `VAPID_SUBJECT` | `mailto:` and the app's Gmail address, like `mailto:foodtruckim@gmail.com` |

3. In Cloudflare, open your project (**Workers & Pages**, then `foodtruckim`), then **Settings**, then **Variables and Secrets**. Press **Add**, name it `VITE_VAPID_PUBLIC_KEY`, paste the public key, and save.
4. Cloudflare only uses the new key after a fresh build. Go to **Deployments**, and on the newest one press the three dots, then **Retry deployment**. (If you can't find that, any new code going up to GitHub does the same thing.)
5. On each phone, open **My account** and turn on **Notifications on this device**. On an iPhone, add the app to the home screen first and open it from there, or the switch won't work.

## Backups

Every Monday morning GitHub saves a copy of the whole database, locked with your backup passphrase, and keeps it for 30 days. Find them in the **Actions** tab, under **Weekly backup**, at the bottom of each run. To open one on a computer: `gpg --decrypt backup.tar.gz.gpg > backup.tar.gz`, then type the passphrase.

If the repository is public, GitHub stops timed runs after 60 days with no new code. If backups stop, open **Actions**, then **Weekly backup**, and turn it back on.

## If something doesn't work

* **No emails arrive**: check the spam folder. Check the Gmail app password (no spaces) and that custom SMTP is on (Step 5). In Supabase, **Table Editor**, then the `outbox` table, shows each app email and any error.
* **"That link didn't work"**: links work once and for 24 hours. Send a new invite from the People screen, or use **Forgot your password?** on the login page.
* **The app says it isn't connected**: one of the two Cloudflare variables in Step 4 is missing or has a typo. Fix it in **Settings**, **Variables and Secrets**, then retry the newest deployment.
* **The GitHub deploy has a red X**: click it and open the red step. Usually a secret from Step 3 has a typo or a space at the end.
* **The project is paused**: free Supabase projects pause after about a week with nobody using them, and Supabase emails you first. Open the project in Supabase and press **Restore**. Nothing is lost.
* **No reports or alerts**: check you ran `3-jobs-timer.sql` (Step 7). Reports go out at the hours in **Business settings**, in the business's time zone. Each person picks what they get in **My account**.
* **No push notifications**: check Step 9, and that the phone allowed notifications for the app. The `outbox` table shows each one and any error.

## When you outgrow the free plans

* Supabase Pro ($25 a month) gives 8 GB of database space, daily backups, and no pausing. Upgrading is one button in Supabase. Nothing in the app changes.
* With your own domain, switch email from Gmail to Resend or Brevo for better delivery. Change the Edge Function secrets (`EMAIL_PROVIDER`, `EMAIL_FROM`, and the provider's key) and the Supabase SMTP settings. No code changes.
* A custom address (like `app.yourbusiness.com`) can be added in Cloudflare under your project's **Custom domains**. Then update the Site URL, Redirect URLs, and `SITE_URL` to match.
