# Deploying Agenda

The app is a Node server with a SQLite file next to it. That shapes every
choice here:

- **It needs a persistent disk.** Vercel, Netlify and other serverless hosts
  give you a filesystem that resets constantly — the dorm's data would
  vanish without warning. Don't deploy there.
- **It needs exactly one instance.** Two instances means two SQLite files and
  two different versions of the truth, with nothing looking broken.
- **It needs HTTPS.** iOS only offers *Add to Home Screen* as a real app over
  a secure origin.

The Dockerfile in this repo builds and runs correctly, and the database
survives the container being destroyed and replaced — that's been tested.

---

## Fly.io

Configured for **one always-on machine in `ord` (Chicago)** — the closest Fly
region to South Bend, about 90 miles out.

Always-on rather than sleeping is a deliberate choice, and it's what
`min_machines_running = 1` in `fly.toml` does. It costs roughly $3.50/month
instead of about $0.50, and buys two things: no cold-start pause when you open
the app, and a background calendar sync that actually runs. That sync
(`src/instrumentation.ts`) pulls iCloud every 10 minutes whether or not anyone
is looking, so the data is already current when you open the app rather than
being fetched while you wait.

### Deploying from a browser, with no computer setup

If you don't want to install anything — a borrowed machine, a work laptop, or
you're on a phone — skip the steps below entirely. `.github/workflows/deploy.yml`
runs the deploy on GitHub's servers instead.

One-time setup, all in a browser:

1. **Fly** → your app → **Tokens** → create a deploy token → copy it.
2. **GitHub** → the repo → **Settings** → **Secrets and variables** →
   **Actions** → **New repository secret**. Name it exactly `FLY_API_TOKEN`,
   paste the token, save.

Then, any time you want to deploy: **Actions** tab → **Deploy to Fly** → **Run
workflow**. It also runs by itself whenever the branch changes.

A green tick means it's live. A red cross means it failed, and clicking into
the run shows why.

The rest of this section is the laptop route, if you'd rather have it local.

### 1. Install and sign in

```bash
curl -L https://fly.io/install.sh | sh      # macOS/Linux
fly auth signup                             # or: fly auth login
```

### 2. The app name

Already set: `fly.toml` says `app = "agenda-nd"`, so the app lives at
`https://agenda-nd.fly.dev`. If you ever rename it in Fly, change it here too —
`fly deploy` reads this file to decide what it's deploying to.

Leave `primary_region = "ord"` alone unless you move — that's Chicago, the
closest region to Notre Dame.

### 3. Create the app and its volume

```bash
fly apps create agenda-nd
fly volumes create agenda_data --size 1 --region ord --yes
```

One gigabyte is far more than this will ever need. **The volume region must
match `primary_region`** — a volume in the wrong region simply won't attach.

### 4. Set the session secret

```bash
fly secrets set AGENDA_SECRET=$(openssl rand -hex 32)
```

This does two jobs: it signs session cookies, and it derives the key that
encrypts stored iCloud app-specific passwords. Connecting an iCloud account is
refused outright until it's set.

**Set it once and leave it.** Rotating it later makes every stored iCloud
password permanently undecryptable — you'd have to reconnect both accounts —
and signs everyone out. Fly won't show the value back, so save a copy in your
password manager now if you want one.

### 5. Deploy

```bash
fly deploy
fly scale count 1     # see the warning below
fly open
```

> **Run `fly scale count 1`.** Fly's default is two machines for high
> availability. With SQLite on a volume that's actively harmful: the second
> machine gets its own empty volume, and you and your roommate would silently
> see different data depending on which machine answered. One machine, always.

The first screen asks for both your names and a dorm passcode. Give the
passcode to your roommate — that's the whole account system.

The app's timezone already defaults to `America/Indiana/Indianapolis`, which is
St. Joseph County's zone — Eastern, with daylight saving. (Indiana isn't
uniform: the northwest corner of the state runs on Central. South Bend does
not.) You can change it in Setup if you ever move.

### 6. Put it on your phones

Open the URL in **Safari** (not Chrome — only Safari can install to the home
screen on iOS), then Share → **Add to Home Screen**.

### Shipping changes later

```bash
fly deploy
```

Both phones pick it up the next time either of you opens the app. There's no
service worker to invalidate and no cache to clear.

### Backups

The volume is one disk in one datacenter. Fly snapshots volumes daily, but for
something you'd be annoyed to lose:

```bash
fly ssh console -C "cat /data/agenda.db" > agenda-backup-$(date +%F).db
```

---

## Any other Docker host

A VPS, a home server, a NAS — anything that runs Docker and has a real disk.

```bash
docker build -t agenda .
docker run -d --restart unless-stopped \
  -p 3000:3000 \
  -v agenda-data:/data \
  -e AGENDA_SECRET=$(openssl rand -hex 32) \
  --name agenda agenda
```

Two things are then on you:

- **HTTPS.** Put [Caddy](https://caddyserver.com) in front — it gets a
  certificate automatically, and it's about four lines of config. Without it
  iOS won't install the app to the home screen.
- **Backups.** `docker run --rm -v agenda-data:/data -v $PWD:/out alpine cp /data/agenda.db /out/`

## Environment variables

| Variable | Needed? | What it's for |
| --- | --- | --- |
| `AGENDA_SECRET` | Required | Signs session cookies and encrypts stored iCloud passwords. Without it, iCloud accounts can't be connected at all, and the cookie key falls back to one kept in the database — so rebuilding the database signs everyone out. |
| `AGENDA_DB_PATH` | Set by `fly.toml`/Dockerfile | Where the SQLite file lives. Must be on the persistent volume. |
| `AGENDA_CALDAV_URL` | Optional | Defaults to iCloud. Change it for Fastmail or a self-hosted CalDAV server. |
| `AGENDA_CRON_SECRET` | Optional | Enables `GET /api/refresh` for an external scheduler. The app already refreshes itself when opened. |

## If something's wrong

**Everything reset after a deploy.** The volume isn't mounted. `fly volumes
list` should show one volume, and `fly.toml` must have the `[[mounts]]` block
pointing at `/data`.

**You and your roommate see different data.** More than one machine is running.
`fly scale count 1`.

**A calendar shows an error in Setup.** The published link stopped working —
usually because the calendar was un-published in iCloud. Re-publish it and
paste the new link; the error text on that screen says what the server
returned.

**Signed out constantly.** `AGENDA_SECRET` isn't set, or changes between
deploys.
