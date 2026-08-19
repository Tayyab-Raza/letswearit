# LetsWearIt

AI virtual try-on for Shopify. A shopper uploads a photo, the app generates
a realistic image of them wearing the product, and — depending on the
merchant's plan — a lot more on top of that: size guidance, multiple
angles, full outfits, a saved closet, and short try-on videos.

Built on the Shopify App Template (React Router + Prisma + MongoDB), with
a storefront theme app extension for the customer-facing widget.

## What it does

- **AI try-on** — customer uploads a photo (or uses a sample), the app
  composites the product onto them using Gemini's image model.
- **Category-aware compositing** — a product isn't just "a garment." The
  app classifies each product into one of six categories (`outfit`,
  `footwear`, `handbag`, `jewelry_necklace`, `jewelry_ear`, `jewelry_hand`)
  and anchors the generation accordingly — a necklace goes on the neck, a
  shoe replaces the shoe on both feet, a ring goes on the hand — with
  matching photo-upload guidance for each ("show both feet" vs. "show your
  neckline" vs. "show your hand").
- **Size & fit guidance** — a conservative size suggestion estimated from
  the customer's photo, mapped onto the merchant's size chart when one is
  set.
- **Multi-angle spin viewer** — drag to rotate through several generated
  angles per product instead of a single static shot.
- **Full outfit try-on** — combine multiple products (e.g. top + bottom, or
  an outfit + a bag) into one generation instead of one item at a time.
- **Try-on history & closet** — a shopper's past try-ons on a product (and
  across the whole store) are saved and can be revisited or compared
  side-by-side, without needing an account — identity is a persistent
  anonymous ID, upgraded to their Shopify customer ID when they're logged
  in.
- **Short try-on video** — a brief turn/rotation clip generated from an
  already-approved still, via Veo through the Gemini API.
- **Usage-based billing** — three plans, a free trial, usage warning/limit
  emails, and per-feature gating so add-ons are tied to plan tier.

## Plan tiers

| Feature | Starter | Growth | Pro |
|---|---|---|---|
| AI try-on | ✅ | ✅ | ✅ |
| Size & fit guidance | ✅ | ✅ | ✅ |
| Multi-angle spin viewer | – | ✅ | ✅ |
| Full outfit try-on | – | ✅ | ✅ |
| Try-on history & closet | – | ✅ | ✅ |
| Short try-on video | – | – | ✅ |

Every feature is unlocked during the free trial so merchants can evaluate
the full app before choosing a plan. Edit `prisma/seed.js` to change the
mapping, or `TRIAL_FEATURES` in `app/services/plan.server.js` to change
trial behavior.

## Architecture

```
app/
  routes/
    api.tryon.jsx            # main generation endpoint (single item + full outfit)
    api.sizefit.jsx           # size & fit estimate
    api.tryon.video.jsx       # short turn video from an approved still
    api.tryon.category.jsx    # product → category + photo guidance (pre-upload)
    api.tryon.features.jsx    # which add-ons this store's plan unlocks
    api.tryon.history.jsx     # past generations — per-product or full closet
    app.*                     # merchant admin (Shopify-embedded)
    webhooks.*                # app lifecycle + subscription webhooks
  services/
    category.server.js        # product → category classifier (+ cache)
    tryon-prompts.server.js    # per-category prompts, anchors, photo requirements
    sizefit.server.js          # size estimate via Gemini
    video.server.js            # Veo 3.1 via the Gemini API
    generation.server.js       # save/query stored try-on results
    usage.server.js            # per-store generation limits + threshold emails
    plan.server.js             # feature gating (hasFeature/requireFeature)
    store.server.js            # install/trial lifecycle
    email.server.js            # usage & trial emails (Resend)

extensions/lets-wear-it/       # storefront theme app extension (the widget)
  blocks/ai-tryon.liquid
  assets/ai-tryon.js
  assets/ai-tryon.css

prisma/schema.prisma            # Store, Plan, Generation, ProductProfile, UsageLog
```

### How a generation request flows

1. Widget opens → fetches the store's unlocked `features` and the
   product's `category` (with photo guidance) in parallel.
2. Customer uploads a photo → optionally requests a size suggestion.
3. Customer hits generate → `api.tryon.jsx`:
   - checks the store's usage limit
   - classifies the product's category (cached after the first time)
   - gates the requested angle / full-outfit request against the store's
     plan features
   - builds the category-specific prompt and calls Gemini's image model
   - on success, records usage and saves the **output** image to
     `Generation` (the customer's uploaded source photo is never stored)
4. Widget shows the result, offers additional angles (drag to spin),
   video, add-to-cart, and share.

### Identity & history

Shoppers on a product page usually aren't logged in, so history isn't
keyed on `customer.id` alone. The widget generates a persistent anonymous
ID on first open (stored in `localStorage`) and sends it with every
request; it's paired with the Shopify customer ID when one is available.
`Generation` rows are queried by either, so a returning shopper — logged
in or not — sees their past try-ons on that product and in their closet.

## Setup

```bash
npm install
npx prisma generate
npx prisma db push
npm run setup       # generates the Prisma client + seeds Plan rows
shopify app dev
```

### Environment variables

| Var | Required | Notes |
|---|---|---|
| `SHOPIFY_API_KEY` | yes | from `shopify.app.toml` / Partner Dashboard |
| `SHOPIFY_API_SECRET` | yes | same |
| `SCOPES` | yes | comma-separated, set in `shopify.app.toml` |
| `SHOPIFY_APP_URL` | yes | your app's public URL |
| `DATABASE_URL` | yes | MongoDB connection string |
| `GEMINI_API_KEY` | yes | powers try-on generation, category classification, size/fit, and video (Veo) |
| `RESEND_API_KEY` | yes | usage-limit and trial emails |
| `NODE_ENV=production` | yes, in prod | required by the deployment docs below |
| `VEO_MODEL` | no | defaults to `veo-3.1-fast-generate-preview` |

Shopify-specific vars are injected automatically by `shopify app dev`
locally; set them by hand for a production deploy.

### Per-product setup (merchant side)

- **Apparel**: upload front/back/side reference images via the `tryon`
  metafield namespace (`front_image`, `back_image`, `side_image`).
- **Footwear / bags / jewelry**: no per-angle upload needed — the
  product's featured image is used as the reference.
- **Size chart** (optional, any category): set a `tryon.size_chart`
  metafield as JSON, e.g. `[{"size":"S","chest_in":36}, ...]`, to get
  merchant-specific size labels instead of a generic size band.
- **Full outfit companions** (optional): pick "complete the look" products
  per product page from the app embed block's settings in the theme
  editor.

## Known v1 simplifications

- Full outfit relies on merchants manually picking companion products per
  page rather than auto-suggesting them.
- The spin viewer generates extra angles on demand as the customer drags,
  rather than pre-generating the full set.
- Category classification falls back to `outfit` if both the keyword match
  and the AI vision fallback are inconclusive — worth spot-checking
  accuracy against a real catalog.
- Video generation polls inline within the request (up to ~90s) rather
  than using a submit-now/poll-separately pattern; fine for launch, worth
  revisiting under real traffic.
- Video output is returned as a data URL rather than uploaded to blob
  storage — works, but doesn't scale as well as it does for images.

## Privacy note

`Generation` rows store the **output** image/video only — never the
customer's uploaded source photo. The widget should carry a short
disclosure on first upload (e.g. "your photo is used to generate this
preview and isn't stored — only the result is saved to your try-on
history"); a few jurisdictions treat face/body photos as sensitive
biometric data, and this storage design plus a clear disclosure covers the
common cases.

## Credits

Forked from the [Shopify App Template — React
Router](https://github.com/Shopify/shopify-app-template-react-router).
See `CHANGELOG.md` for template-level upstream changes.
