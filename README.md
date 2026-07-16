# UPGB OTS Calculator — hosted PWA

A hosted, installable version of the OTS (One Time Settlement) calculator. Unlike
the original single-file offline HTML tool, borrower data now lives **only on
the server** — the browser gets the app shell (HTML/CSS/JS) and talks to it
through an authenticated API. Search results only return the fields needed for
the result list; full borrower detail (Aadhar/PAN/mobile/address) is only sent
after you open that specific record.

## Before you do anything else

This app is designed to hold real NPA borrower data (names, Aadhar, PAN, mobile
numbers, loan balances) and to be reachable from the public internet. A few
things that matter more here than in a typical side project:

- **Never commit real data.** `data/npa-data.json` (created automatically the
  first time someone uploads a workbook) is in `.gitignore` for exactly this
  reason. Double check `git status` before every commit — if that file ever
  shows up as staged, something is wrong.
- **Check with your bank's IT/compliance team before hosting real customer
  PII on a third-party cloud platform.** RBI outsourcing and data-localization
  expectations may apply to hosting borrower data (even Aadhar/PAN fragments)
  outside the bank's own infrastructure. This code doesn't make that call for
  you — an intranet/on-premise deployment avoids the question entirely if
  that's an option.
- **The passphrases are the only thing standing between the internet and this
  data.** There are two tiers: `ADMIN_PASSPHRASE` (upload access) and
  `USER_PASSPHRASE` (search/calculate only, no upload). Everyone who has
  either one can see every borrower's full detail — the tiers only gate the
  *upload* feature, not what data is visible. If someone leaves the group,
  rotate both passphrases immediately (see below).

## Local setup

```bash
npm install
cp .env.example .env
# edit .env: set ADMIN_PASSPHRASE, USER_PASSPHRASE, and SESSION_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # generates a SESSION_SECRET
npm start
```

Visit `http://localhost:3000` and sign in with either passphrase:
- **Admin passphrase** → full access, including the "Update Data" button
  (top right) to upload your NPA workbook (.xlsx with an `NPA` sheet,
  optionally an `OLD OTS` sheet) or a daily `e-AB NPA AC WISE` CSV export.
- **User passphrase** → search/detail/calculate only; the Update Data button
  doesn't appear, and the upload endpoint rejects the request server-side
  even if someone tries to call it directly.

Whichever passphrase uploads data, it becomes the live dataset for everyone
signed in, saved to `data/npa-data.json` on the server so it survives a
restart.

## Deploying

### 1. Push the code (not the data) to a private GitHub repo

```bash
git init
git add .
git commit -m "Initial commit"
gh repo create upgb-ots-webapp --private --source=. --push
```

`data/npa-data.json`, `.env`, and `node_modules/` are already excluded via
`.gitignore` — verify with `git status` before pushing that none of them are
staged.

### 2. Host the Node server somewhere with HTTPS

A domain name (e.g. one bought via Squarespace Domains, formerly Google
Domains) doesn't run anything by itself — it just points visitors somewhere.
GitHub Pages won't work either, since it's static-only and can't run this
server or protect data behind a login. You need an actual host to run
`server.js`:

- **Render.com** or **Railway.app** — connect your GitHub repo, they detect
  `npm start`, set `ADMIN_PASSPHRASE`/`USER_PASSPHRASE`/`SESSION_SECRET` as
  environment variables in their dashboard (never in the repo), and both
  give you free HTTPS out of the box. Render's free tier sleeps when idle
  (slow first load); a paid "always on" instance avoids that.
- **A small VPS** (if your bank already has one) — more control, but you own
  patching, HTTPS certs (use Certbot/Let's Encrypt), and process supervision
  (`pm2` or a systemd unit).

Either way: set `NODE_ENV=production` so session cookies get the `secure`
flag (cookies only sent over HTTPS).

#### Pointing your Squarespace domain at the host

Once deployed, the host gives you a default URL (e.g.
`ots-utility.onrender.com`). To use your own domain instead:

1. In Render/Railway's dashboard, add your custom domain (e.g.
   `ots.yourdomain.com`) under the service's "Custom Domains" / "Networking"
   settings — it'll show you a CNAME target to point to.
2. In Squarespace's [domain DNS settings](https://account.squarespace.com/domains),
   add a CNAME record: host `ots` (or whatever subdomain you want), pointing
   to the target Render/Railway gave you.
3. Wait for DNS to propagate (usually minutes, sometimes a few hours), then
   the host will auto-issue an HTTPS certificate for your domain.

Using a subdomain (`ots.yourdomain.com`) rather than the bare domain is
simpler to set up with a CNAME; a bare/apex domain needs an A/ALIAS record
instead, which the host's custom-domain instructions will show if needed.

### 3. Upload real data once, on the live server

After deploying, sign in and use "Update Data" to upload the real NPA
workbook directly on the hosted app — don't put it in the repo or commit it
anywhere.

## Rotating a passphrase

Change `ADMIN_PASSPHRASE` and/or `USER_PASSPHRASE` in your host's environment
variables and redeploy/restart. Everyone's existing session stays valid until
it expires (12 hours) or they sign out — for an immediate cutoff, also change
`SESSION_SECRET` in the same step, which invalidates all existing sessions
instantly.

## Installing as a PWA

Once deployed over HTTPS, visiting the site and signing in will let mobile
Chrome/Edge/Safari offer "Add to Home Screen" / "Install app" — the manifest
and service worker are already wired up. The service worker only caches the
static app shell (CSS/JS/icons), never search results or borrower detail, so
nothing sensitive gets cached to disk client-side.

## What's different from the original offline file

- The `xlsx` client-side library and the whole dataset no longer ship to the
  browser — parsing happens server-side (`lib/parse-upload.js`), and every
  formula (`lib/ots-engine.js`) is a straight port of the original calculator
  so figures match exactly.
- Search/detail are now API calls (`/api/search`, `/api/detail`) instead of
  scanning an in-memory blob already sitting in the page.
- The "Download Updated App (.html)" button is gone — data updates now live
  on the server permanently instead of producing a new self-contained file
  each time.
