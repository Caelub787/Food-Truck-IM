# Setting up Food Truck IM (free)

This puts Food Truck IM online at your own domain, on free plans. Plan on about an hour and a half the first time, plus some waiting while the domain switches over. You only do it once. A computer is easier than a phone for this.

When it's done:

* **foodtruckim.com** is your website. It explains the app and has the demo at foodtruckim.com/demo.
* **app.foodtruckim.com** is the app itself, where people sign up and log in.
* App emails come from **noreply@foodtruckim.com**, and replies go to your GoDaddy inbox.

You'll use these accounts. Everything except GoDaddy is free, with no credit card:

1. **GoDaddy** (you have it): your domain and your email inbox. They stay at GoDaddy.
2. **GitHub** (you have it): holds the app's code, sets up the database, and makes weekly backups.
3. **Cloudflare**: runs your domain's settings (DNS) and puts the website and app online.
4. **Resend**: sends the app's emails from your domain. Free for 100 emails a day.
5. **Supabase**: the database, logins, pictures, and live updates.
6. **Plaid** (optional, Step 12): lets businesses see their bank balances on the Budget page. View only. Its free Trial plan covers up to 10 bank logins.

Screens in these services change now and then. If a button has a slightly different name, look for the closest match.

**Never paste any password, key, or token into a chat, an email, or the code.** Each one only goes in the spot this guide names.

## Your note

Open a note on your computer (a password manager is best) and keep these as you go:

| What | Where it comes from | Where it goes |
|---|---|---|
| Your inbox address | Your GoDaddy email (like you@foodtruckim.com) | Supabase |
| Resend API key | Step 2 | Supabase (twice) |
| Database password | Step 3 | GitHub |
| Project URL | Step 3 | Cloudflare, SQL step |
| Publishable key | Step 3 | Cloudflare |
| Project ID | Step 3 | GitHub |
| Access token | Step 3 | GitHub |
| Backup passphrase | Step 4 (you make it up) | GitHub |
| Cron secret | Step 8 (you make it up) | Supabase, SQL step |
| Push keys | Step 11 (the app makes them) | Supabase, Cloudflare |
| Plaid client_id and secret | Step 12 (optional) | Supabase |
| Bank key | Step 12 (the app makes it) | Supabase |

When this guide says "make up a long password", use only letters and numbers (no symbols), at least 30 of them. Your password manager's "generate password" button works if you turn symbols off.

## Step 1: Let Cloudflare run your domain's settings (20 minutes, then some waiting)

Your domain stays registered at GoDaddy and you keep paying GoDaddy for it like before. You're only moving its settings (called DNS) to Cloudflare, which is free and makes the rest of this setup much easier. Your GoDaddy email keeps working as long as its records come along, which this step checks.

1. **Make a backup of your current settings.** Log in to GoDaddy, open **My Products** (or **Domain Portfolio**), click **foodtruckim.com**, then **DNS**. Take screenshots of the whole list of records (scroll to see them all). Pay attention to the ones for email: type **MX**, type **TXT** that start with `v=spf1`, and type **CNAME** with names like `email`, `autodiscover`, or ones pointing to `secureserver.net` or `outlook.com`.
2. **Check DNSSEC is off.** In GoDaddy, on the domain's page, look for **DNSSEC** (often under **Domain settings** or the DNS page). It's usually off. If it's on, turn it off and wait one full day before doing number 7 below.
3. Go to **dash.cloudflare.com** and make an account. Confirm your email.
4. In Cloudflare, press **Add a domain** (it may say **Onboard a domain** or **Add a site**). Type `foodtruckim.com`, keep **Quick scan for DNS records** picked, and press **Continue**.
5. Pick the **Free** plan and press **Continue**.
6. **Compare the records.** Cloudflare shows the records it found. Check them against your GoDaddy screenshots. Every MX, TXT, and CNAME from GoDaddy should be in the list. If one is missing, press **Add record** and copy it in exactly (Type, Name, and Content, plus Priority for MX).
   * Any record for email (names like `email`, `mail`, `autodiscover`, `msoid`, `lyncdiscover`, `sip`, `enterpriseregistration`, `enterpriseenrollment`, or anything pointing to `secureserver.net`, `outlook.com`, or `office.com`) must show a **grey cloud** that says **DNS only**. If it shows an orange cloud, press **Edit** and switch it to DNS only, then **Save**.
   * Leave everything else as it is for now. Then press **Continue to activation** (or **Continue**).
7. Cloudflare shows **two nameservers**, like `ada.ns.cloudflare.com` and `bob.ns.cloudflare.com`. Keep that page open.
8. In GoDaddy, on the domain's **DNS** page, click the **Nameservers** tab, then **Change Nameservers**. Pick **I'll use my own nameservers** (it may say **Enter my own nameservers**). Type in the two from Cloudflare, one per box, and press **Save**. GoDaddy warns you that its DNS settings will stop being used. That's expected, since Cloudflare has them now. Confirm.
9. Back in Cloudflare, press **Check nameservers now** (or **Done, check nameservers**). It can take a few minutes to a day, usually under an hour. Cloudflare emails you when foodtruckim.com is **Active**.

**While you wait, do Steps 3 and 4.** They don't need the domain.

10. Once Cloudflare says Active, test your email: send a message to your GoDaddy inbox from another email account, then reply from your GoDaddy inbox. If it doesn't arrive, compare Cloudflare's records with your screenshots again and add what's missing.

## Step 2: Resend, for the app's emails (10 minutes, after Step 1 says Active)

1. Go to **resend.com** and sign up (signing in with GitHub works).
2. Click **Domains**, then **Add Domain**. Type `foodtruckim.com`, leave the region as it is, and press **Add**.
3. Resend shows a few DNS records to add (usually an MX and a TXT named `send`, and a TXT named `resend._domainkey`).
   * If you see a **Sign in to Cloudflare** button (it may say **Auto configure**), press it and approve. Resend adds the records for you.
   * If not, add them by hand: in Cloudflare, open **foodtruckim.com**, then **DNS**, then **Records**, then **Add record**. For each one, copy the Type, Name, and Value (and Priority if it has one) exactly from Resend. In the Name box, type only what Resend shows (like `send`). Cloudflare adds the rest. If there's a proxy switch, set it to **DNS only**.
   * If Resend also lists a **DMARC** record (named `_dmarc`) and your Cloudflare list doesn't already have a `_dmarc` record, add that one too. If you already have one, leave yours.
4. Back in Resend, press **Verify DNS Records**. It usually takes a few minutes. The domain turns **Verified** when it's done.
5. Click the domain and make sure **Click tracking** and **Open tracking** are off (they are at first). Click tracking would break the login links in emails.
6. Click **API Keys**, then **Create API Key**:
   * Name: `Food Truck IM`
   * Permission: **Sending access**
   * Domain: `foodtruckim.com`
   * Press **Add**, then copy the key (it starts with `re_`) into your note. It's only shown once.

## Step 3: Supabase (10 minutes)

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

## Step 4: Let GitHub set up the database (10 minutes)

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

## Step 5: Put the app online at app.foodtruckim.com (10 minutes)

1. In Cloudflare, open **Workers & Pages** in the left menu (it may be inside **Compute & AI**).
2. Press **Create application**. Cloudflare opens the Workers screen first. Look for the **Pages** tab (or a link like "Looking to deploy Pages? Get started") and click it.
3. Press **Connect to Git** (it may say **Import an existing Git repository**), pick **GitHub**, and press **Install & Authorize**. When GitHub asks which repositories, pick **Only select repositories**, choose `Food-Truck-IM`, and approve.
4. Back in Cloudflare, pick `Food-Truck-IM` and press **Begin setup**.
5. On **Set up builds and deployments**:
   * **Project name**: `foodtruckimapp`
   * **Production branch**: `ccr-ee84e127-hvai58` (it's the only one)
   * **Framework preset**: None
   * **Build command**: `npm run build`
   * **Build output directory**: `dist`
   * Open **Environment variables (advanced)** and add two (press **Add variable** for each):

     | Variable name | Value |
     |---|---|
     | `VITE_SUPABASE_URL` | your Project URL |
     | `VITE_SUPABASE_PUBLISHABLE_KEY` | your Publishable key |

6. Press **Save and Deploy**. It takes 2 or 3 minutes. When it's done, press **Continue to project**.
7. Click the **Custom domains** tab, then **Set up a custom domain**. Type `app.foodtruckim.com`, press **Continue**, then **Activate domain**. After a few minutes it says **Active**.
8. Open **https://app.foodtruckim.com**. You should see the Food Truck IM login page. (Logging in won't work until Steps 7 to 9 are done.)

## Step 6: Put the website online at foodtruckim.com (10 minutes)

1. **Clear the old parking page.** In Cloudflare, open **foodtruckim.com**, then **DNS**, then **Records**. If there's an **A** record named `foodtruckim.com` (or `@`), or a record named `www`, they point to GoDaddy's old parking page. Delete them (press **Edit**, then **Delete**). **Don't delete** any MX or TXT records, or anything for email.
2. Go back to **Workers & Pages**, press **Create application**, then the **Pages** tab, then **Connect to Git**, and pick `Food-Truck-IM` again. Press **Begin setup**.
3. On **Set up builds and deployments**:
   * **Project name**: `foodtruckim`
   * **Production branch**: `ccr-ee84e127-hvai58`
   * **Framework preset**: None
   * **Build command**: `npm run build:site`
   * **Build output directory**: `dist-site`
   * No environment variables needed.
4. Press **Save and Deploy**, wait for it to finish, then press **Continue to project**.
5. Click **Custom domains**, then **Set up a custom domain**. Type `foodtruckim.com`, press **Continue**, then **Activate domain**.
6. Do it once more for `www.foodtruckim.com`.
7. After a few minutes, open **https://foodtruckim.com**. You should see the website. Try **Try the demo** too.

From now on, every time new code goes up on GitHub, Cloudflare rebuilds the website and the app on its own.

## Step 7: Supabase login and email settings (15 minutes)

All of this is in your Supabase project, in the left menu under **Authentication**.

1. **URL Configuration**:
   * **Site URL**: `https://app.foodtruckim.com`. Press **Save**.
   * Under **Redirect URLs**, press **Add URL** and enter `https://app.foodtruckim.com/**`. Save.
2. **Sign In / Providers**, then click **Email**:
   * **Confirm email**: on.
   * **Email OTP Expiration**: `86400` (that's 24 hours, so invite and confirm links don't run out too fast).
   * Press **Save**.
3. **Emails**, then the **SMTP Settings** tab. Turn on **Enable custom SMTP** and fill in:
   * **Sender email address**: `noreply@foodtruckim.com`
   * **Sender name**: `Food Truck IM`
   * **Host**: `smtp.resend.com`
   * **Port number**: `465`
   * **Username**: `resend`
   * **Password**: your Resend API key
   * Press **Save changes**.
4. **Emails**, then the **Templates** tab. There are four to change. For each one:
   1. Open its file on GitHub (in the repository, click the `supabase` folder, then `templates`), and press the **Copy raw file** button (two squares, top right of the file).
   2. In Supabase, click the template, set the **Subject**, then select everything in the message box, delete it, and paste.
   3. Press **Save changes**.

   | Template | File | Subject |
   |---|---|---|
   | Confirm sign up | `confirmation.html` | Confirm your email |
   | Invite user | `invite.html` | You're invited |
   | Reset password | `recovery.html` | Reset your password |
   | Change email address | `email_change.html` | Confirm your new email |

## Step 8: Supabase server settings (5 minutes)

1. In the left menu, click **Edge Functions**, then **Secrets**.
2. Add these six. For each, type the **Name**, paste the **Value**, and press **Save** (or add them all, then save):

   | Name | Value |
   |---|---|
   | `SITE_URL` | `https://app.foodtruckim.com` |
   | `EMAIL_PROVIDER` | `resend` |
   | `RESEND_API_KEY` | your Resend API key |
   | `EMAIL_FROM` | `Food Truck IM <noreply@foodtruckim.com>` |
   | `EMAIL_REPLY_TO` | your GoDaddy inbox address. Replies to app emails go here. (Replies to supplier orders go to the manager who approved the order.) |
   | `CRON_SECRET` | make up a long password (letters and numbers only) and save it in your note |

## Step 9: Three quick SQL steps (5 minutes)

In Supabase, click **SQL Editor** in the left menu. For each file below: open it on GitHub (in the `supabase/setup` folder), press **Copy raw file**, then in Supabase press **+** (new query), paste, make the change it asks for, and press **Run** (bottom right). It should say **Success**.

1. `1-app-owner.sql` makes you the App Owner. Change `you@example.com` to the email **you'll log in with** (your GoDaddy inbox works). Keep the quote marks around it.
2. `2-email-timer.sql` makes emails go out every minute. Change `https://YOUR-PROJECT.supabase.co` to your Project URL and `PASTE-YOUR-CRON-SECRET` to your cron secret. Keep the quote marks.
3. `3-jobs-timer.sql` turns on reports, alerts, reminders, order lists, par suggestions, and photo cleanup. Nothing to change.

Only run each one once. If one says something "already exists", it was already done and you can move on.

## Step 10: Make your account

1. On your phone, open **https://foodtruckim.com** and tap **Sign up** (or go straight to **https://app.foodtruckim.com/signup**).
2. Fill in the **Sign up your business** form. Use the same email you put in `1-app-owner.sql`.
3. Open the email from Food Truck IM and tap the link to confirm. Check spam the first time, and mark it "not spam".
4. Log in. App Owners are approved right away, and you'll see the **App owner** page (called **Owner** on phones, under **More** if it doesn't fit). That's where you approve other businesses that sign up.
5. Add the app to your home screen so it opens like a normal app. Do this from **app.foodtruckim.com**, not the website:
   * iPhone (Safari): tap **Share**, then **Add to Home Screen**.
   * Android (Chrome): tap the menu (three dots), then **Install app** or **Add to Home screen**.
6. Set up your business: trucks, supplies (add pictures if you like), products, and people. The starter kits fill in a lot for you. See [GUIDE.md](GUIDE.md).
7. To let clients book your trucks, open **Business settings**, turn on **Booking page** under **Client bookings**, and press **Save**. Your page is at `https://app.foodtruckim.com/book/` plus the page name shown there. Share that link anywhere.
8. The **Budget** page works right away with balances you type in. Step 12 adds bank balances.

## Step 11: Push notifications (optional, 10 minutes)

Push notifications are the alerts that pop up on phones (low stock, reminders, order lists). Emails work without this step.

1. In the app, open the **App owner** page and scroll down to **Push notification keys**. Tap **Make push keys**. Keep that page open.
2. In Supabase, **Edge Functions**, then **Secrets**. Add three more:

   | Name | Value |
   |---|---|
   | `VAPID_PUBLIC_KEY` | the public key from the app |
   | `VAPID_PRIVATE_KEY` | the private key from the app |
   | `VAPID_SUBJECT` | `mailto:` and your inbox address, like `mailto:you@foodtruckim.com` |

3. In Cloudflare, open the **app** project (**Workers & Pages**, then `foodtruckimapp`), then **Settings**, then **Variables and Secrets**. Press **Add**, name it `VITE_VAPID_PUBLIC_KEY`, paste the public key, and save.
4. Cloudflare only uses the new key after a fresh build. Go to **Deployments**, and on the newest one press the three dots, then **Retry deployment**. (If you can't find that, any new code going up to GitHub does the same thing.)
5. On each phone, open **My account** and turn on **Notifications on this device**. On an iPhone, add the app to the home screen first and open it from there, or the switch won't work.

## Step 12: Bank balances on the Budget page (optional, 20 minutes)

This lets each business link its bank and see balances on the Budget page. It's view only: the app can't pay, move, or touch money. Plaid is the service banks trust for this, and its free Trial plan covers up to 10 bank logins across every business using the app. Without this step, the Budget page still works with balances typed in.

1. Go to **dashboard.plaid.com/signup** and make an account. Confirm your email.
2. If Plaid asks you to pick a plan, pick the free **Trial**. If it asks about your company or how you'll use the data, your business is Food Truck IM, and it's used to show account balances for budgeting.
3. In the Plaid dashboard, open **Developers**, then **Keys** (it may be under **Team Settings**). Copy the **client_id** and the **Production** secret into your note. (The **Sandbox** secret is for testing with pretend banks. Plaid's test login is `user_good` with password `pass_good`.)
4. Still under **Developers**, open **API**, find **Allowed redirect URIs**, add `https://app.foodtruckim.com/budget`, and save. Some big banks send people to their own site to log in and then back to this address.
5. In the app, open **App owner**, scroll down to **Bank link key**, and press **Make a bank key**. Copy it into your note. Make this key only once: if it changes later, every linked bank has to be linked again.
6. In Supabase, **Edge Functions**, then **Secrets**. Add these:

   | Name | Value |
   |---|---|
   | `PLAID_CLIENT_ID` | your Plaid client_id |
   | `PLAID_SECRET` | your Plaid Production secret |
   | `PLAID_ENV` | `production` (or `sandbox` with the Sandbox secret, to test first) |
   | `PLAID_REDIRECT_URI` | `https://app.foodtruckim.com/budget` |
   | `BANK_TOKEN_KEY` | the bank key from the app |

7. Open **Budget** in the app. You'll see **Link a bank**. Press it, pick your bank, and log in. That login happens in Plaid's window, never in this app. The balances show up on the Budget page and update when the page opens.

Some big banks (like Chase) need a few extra days of approval inside Plaid before they can be linked. Plaid's dashboard shows a checklist for that. Other banks work right away.

## Backups

Every Monday morning GitHub saves a copy of the whole database, locked with your backup passphrase, and keeps it for 30 days. Find them in the **Actions** tab, under **Weekly backup**, at the bottom of each run. To open one on a computer: `gpg --decrypt backup.tar.gz.gpg > backup.tar.gz`, then type the passphrase.

If the repository is public, GitHub stops timed runs after 60 days with no new code. If backups stop, open **Actions**, then **Weekly backup**, and turn it back on.

## If something doesn't work

* **Your GoDaddy email stopped working after Step 1**: an email record didn't come over. Compare Cloudflare's DNS records with your GoDaddy screenshots and add what's missing (email ones set to **DNS only**). If you're stuck, you can switch back: in GoDaddy, **Nameservers**, then **Change Nameservers**, then **GoDaddy Nameservers (recommended)**.
* **Cloudflare still says "Pending" after a day**: check that the two nameservers in GoDaddy match Cloudflare's exactly, and that DNSSEC is off.
* **No emails arrive**: check the spam folder. In Resend, click **Emails** to see each one and whether it was delivered. In Supabase, **Table Editor**, then the `outbox` table, shows each app email and any error. Check the Resend domain still says **Verified**.
* **"That link didn't work"**: links work once and for 24 hours. Send a new invite from the People screen, or use **Forgot your password?** on the login page.
* **The app says it isn't connected**: one of the two Cloudflare variables in Step 5 is missing or has a typo. Fix it in the `foodtruckimapp` project's **Settings**, **Variables and Secrets**, then retry the newest deployment.
* **A custom domain in Cloudflare won't turn Active**: wait 10 minutes. If it complains about an existing record, delete that old record (Step 6, number 1) and try again.
* **The GitHub deploy has a red X**: click it and open the red step. Usually a secret from Step 4 has a typo or a space at the end.
* **The project is paused**: free Supabase projects pause after about a week with nobody using them, and Supabase emails you first. Open the project in Supabase and press **Restore**. Nothing is lost.
* **No reports or alerts**: check you ran `3-jobs-timer.sql` (Step 9). Reports go out at the hours in **Business settings**, in the business's time zone. Each person picks what they get in **My account**.
* **No push notifications**: check Step 11, and that the phone allowed notifications for the app. The `outbox` table shows each one and any error.
* **"Link a bank" doesn't show on the Budget page**: one of the Step 12 secrets is missing. All of `PLAID_CLIENT_ID`, `PLAID_SECRET`, and `BANK_TOKEN_KEY` are needed.
* **A bank says "Needs a new login"**: banks ask for this now and then. Press **Log in again** on the Budget page.
* **Nobody can find the booking page**: check **Booking page** is on in **Business settings**, and share the address shown there.

## When you outgrow the free plans

* **More than 100 emails a day**: Resend's paid plan, or Brevo's free plan (300 a day). Either is a settings change only (`EMAIL_PROVIDER`, the key, and the Supabase SMTP settings). No code changes.
* **More database space or no pausing**: Supabase Pro ($25 a month) gives 8 GB, daily backups, and no pausing. Upgrading is one button in Supabase. Nothing in the app changes.
