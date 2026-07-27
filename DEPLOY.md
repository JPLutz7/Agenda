# Deploying Agenda

The app is a Node server with a SQLite file next to it. That shapes every
choice here:

- **It needs a persistent disk.** Vercel, Netlify and other serverless hosts
  give you a filesystem that resets constantly — the household's data would
  vanish without warning. Don't deploy there.
- **It needs exactly one instance.** Two instances means two SQLite files and
  two different versions of the truth, with nothing looking broken.
- **It needs HTTPS.** iOS only offers *Add to Home Screen* as a real app over
  a secure origin.

The Dockerfile in this repo builds and runs correctly, and the database
survives the container being destroyed and replaced — that's been tested.

---

## Fly.io (recommended)

Free HTTPS, a real volume, no monthly minimum, and it sleeps when nobody's
using it.

### 1. Install and sign in

```bash
curl -L https://fly.io/install.sh | sh      # macOS/Linux
fly auth signup                             # or: fly auth login
```

### 2. Pick a name

App names are global, so `agenda` is long gone. Edit `app` in `fly.toml` to
something like `agenda-<yourlastname>`. Your URL becomes
`https://<that-name>.fly.dev`.

Set `primary_region` to somewhere near you — `fly platform regions` lists them.

### 3. Create the app and its volume

```bash
fly apps create <your-app-name>
fly volumes create agenda_data --size 1 --region <your-region> --yes
```

One gigabyte is far more than this will ever need.

### 4. Set the session secret

Without this, everyone gets signed out whenever the database is rebuilt.

```bash
fly secrets set AGENDA_SECRET=$(openssl rand -hex 32)
```

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

The first screen asks for both your names and a household passcode. Give the
passcode to your roommate — that's the whole account system.

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
| `AGENDA_SECRET` | Set it in production | Signs session cookies. Without it, one is generated and stored in the database, so rebuilding the database signs everyone out. |
| `AGENDA_DB_PATH` | Set by `fly.toml`/Dockerfile | Where the SQLite file lives. Must be on the persistent volume. |
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
