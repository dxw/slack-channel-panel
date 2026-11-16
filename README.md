# Slack Channel Panel

A dashboard to aid maintenance of dxw's Slack channels. It shows each public
channel's members and recent activity, and recommends quiet channels to archive.

## Local development

You need the Node.js version in [`.nvmrc`](.nvmrc) (run `nvm use`).

```sh
npm install
cp .env.example .env
npm run dev
```

Then go to http://localhost:3000.

To run without a Slack app or Google sign-in, set these in `.env`:

```sh
SESSION_SECRET=any-long-random-string
DEV_AUTH=true        # sign in with any @dxw.com email address
SLACK_FAKE_DATA=true # use made-up channels
```

If using real data from Slack, the Slack data is saved to `.cache/channels.json`
in development, so restarting the server doesn't refresh it again. Delete the
file to refresh from Slack on the next start.

## Configuration

All environment variables are described in [`.env.example`](.env.example).

**Slack:** create a Slack app with a bot user, add the bot token scopes
`channels:read`, `channels:history`, `channels:join`, `channels:manage` and
`team:read`, and install it to the workspace. Put the bot token (`xoxb-…`) in
`SLACK_BOT_TOKEN`. The bot can only see activity in channels it's a member of.

**Google sign-in:** create an OAuth client ID in Google Cloud Console, with
`<BASE_URL>/auth/callback` as an authorised redirect URI. Only `@dxw.com`
accounts can sign in.

## Testing

```sh
npm test
npm run lint
```

## Deployment

The production app is deployed using Heroku. The deployment runs automatically
on pushes to main.
