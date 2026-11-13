# slack-channel-panel

A dashboard to aid maintenance of dxw slack channels

## Development

```sh
npm install
npm run dev
```

`npm run dev` starts the app with nodemon and rebuilds the Tailwind
CSS whenever you change a template.

In development, the channel data from Slack is saved to
`.cache/channels.json` after each refresh. When the server restarts, it uses
that data if it's less than 6 hours old, instead of refreshing from Slack
again. Delete the file to refresh from Slack on the next start.
