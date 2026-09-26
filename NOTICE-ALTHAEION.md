# Althaeion modifications to Postiz

This branch is [Postiz](https://github.com/gitroomhq/postiz-app) **v2.23.0** (AGPL-3.0,
commit `1e4c8dd`) with additions made for Althaeion's Social Media tool. It is published here
as the AGPL requires: the complete corresponding source of what Althaeion runs.

## What was added

Features ported from TryPost's approach and written for Postiz's own stack (NestJS, Prisma,
Next.js), so they behave as native Postiz features:

- **Automations**: a workflow engine (triggers, delays, conditions, publish, webhooks, RSS
  fetch, HTTP requests) with a step budget so an accidental cycle cannot run forever.
- **Brand**: a brand profile with voice traits and a website analyzer.
- **Ads**: ad campaign and variant generation.
- **Autopilot**: scheduled, rule-driven posting runs.
- **AI usage log and credit costs**, a content reviewer and a humanizer.
- **Connection verifier**: checks social connections before a scheduled post goes out.
- **Link cards** (Open Graph) for Bluesky and Mastodon, **analytics** for Discord and
  Telegram, chunked media uploads, stock media (Unsplash and Giphy, with the user's own keys).
- **Safe HTTP fetcher**: every outbound fetch revalidates each redirect against private and
  link-local addresses.

The database models for these features are added to `schema.prisma`; Postiz applies them with
its usual `prisma db push` at start.

## What was not changed

Everything else is upstream v2.23.0. The files added by Althaeion are listed in the commit that
introduced them. Upstream's copyright and license (AGPL-3.0, see `LICENSE`) apply to the whole.
