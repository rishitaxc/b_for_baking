# B for Baking

Bakery website and Node.js backend with a private owner dashboard, website enquiries, Instagram click insights, cake galleries and a custom cake designer.

## Start locally

Requires Node.js 24 or newer. There are no package dependencies or install/build steps.

```sh
node --env-file-if-exists=.env server.js
```

- Website: http://localhost:8090/
- Owner dashboard: http://localhost:8090/admin
- At first launch, open the dashboard on localhost and create an owner username and a password of at least 12 characters. No default password is provided.
- Local configuration can be copied from `.env.example` into `.env`. Keep `.env` private.

The old static-file preview server cannot save enquiries or provide analytics. Use this Node server for both the website and dashboard.

## What the dashboard shows

- Website page views and unique anonymous browsers.
- Total Instagram link clicks and unique browsers that clicked.
- Clicks separated into profile links, original gallery posts and Baker Bot links.
- Reporting periods of 7, 30 and 90 days, using Asia/Kolkata dates.
- Saved website enquiries, with search, status filters and pagination.
- Customer contact details, celebration date, preferred design, custom illustration, guest count and estimated cake weight.
- Quoted total, manually recorded advances, balance due, private notes and an order history.
- A CSV export of the currently visible enquiry list, and owner password changes.

Customers submit the website form to save an enquiry. The response includes a reference, with an optional WhatsApp follow-up. A received enquiry is not a confirmed order. Required advances must be recorded before the dashboard permits an order to move into a confirmed/in-progress state.

## What Instagram insights mean

Instagram links pass through a first-party redirect before going to Instagram. This records the click even when the destination opens in another tab. It does not prove that Instagram finished loading or that a visitor followed the account. No Instagram username or account identity is collected.

A random, HttpOnly browser cookie lasts for 30 days. Analytics store an HMAC of that identifier with daily counts, not names, phone numbers, raw cookie identifiers or IP addresses. Different devices or cleared cookies can count the same person again. Visitors with JavaScript disabled may not produce a page-view event. Link redirects may also include non-human traffic. Visits and clicks from a signed-in owner browser are excluded. Metrics begin when this backend is used; historical static-site visits cannot be recovered.

## Data and account safety

SQLite stores enquiries, illustrations, metrics, hashed owner credentials, sessions and history under `data/` by default. This directory, environment files and SQLite files are excluded from Git. The server uses an explicit static-file allowlist; it does not serve source files, databases, secrets or the `.git` directory.

Owner sessions use HttpOnly, SameSite cookies, CSRF checks for updates, an eight-hour lifetime and rate-limited sign-in. Passwords use scrypt. All enquiry/analytics writes are checked for the website's origin, and customer fields are validated on the server. Duplicate request identifiers avoid repeated order creation. Quote amounts and cake-weight estimates are calculated/validated by the server; customers cannot set financial fields or confirmation status.

Custom cake pictures are private to authenticated owner requests. Customer text is rendered as text in the dashboard. Order revisions prevent one owner session from silently overwriting changes made in another.

The dashboard does not process or automatically verify payments. Check the bank or payment provider before manually recording an advance. A real payment gateway integration is a separate step.

## Publish the backend

**GitHub Pages and static-only hosting cannot run this backend.** Deploy the whole application to a host that runs Node.js 24+, supports HTTPS and provides a persistent disk. Use a single application instance with this SQLite database. An ephemeral filesystem will lose enquiries when the service is replaced.

Configure through the host's environment/secret settings:

- `NODE_ENV=production`
- `PUBLIC_ORIGIN=https://your-actual-site-address` (the exact public origin; required in production)
- `PORT` (your host's assigned port)
- `DATA_DIR` (a directory on the persistent disk)
- `ADMIN_USERNAME` and `ADMIN_PASSWORD` (at least 12 characters), used to create the owner only when the database is new.

Production bootstrap through the public website is disabled. The public reverse proxy must preserve the site's Host header and terminate HTTPS. The production admin cookie is Secure. If the password has already been changed through the dashboard, changing the bootstrap environment variables does not overwrite it.

A Dockerfile is included. Supply the settings above and mount a persistent volume at `/app/data`. Never put customer data, populated environment files or passwords in the image/repository.

Back up the private database and `visitor-secret` on persistent storage. For a simple consistent backup, stop the server, copy the entire data directory to a private location and then restart. Do not commit backups to GitHub.

## Tests

```sh
node --test tests/backend.test.js
```

Tests use isolated temporary databases, not live customer records. They cover unauthorised access, private-file blocking, setup and sign-in, origin/CSRF protection, validation, idempotent enquiries, metrics and unique-browser counts, order updates, advances, private custom pictures, persistence and logout. Browser checks also cover the public form, owner dashboard, custom image saving and mobile layouts.

## Frontend and photos

The pastel website includes 20 photos each for wedding, birthday and baby celebrations, plus anniversary/gifting references. The baby collection includes alternate views, baby showers, gender reveals and welcome-baby cakes; 20 photos does not mean 20 distinct designs. Original post links are retained in `photo-sources.json`. Photos and business details are from [@b_for_baking](https://www.instagram.com/b_for_baking/), used at the website owner's request.

The custom cake designer saves shape, tiers, colours, decorations, message, flavour wish and an illustration with the enquiry. Weight uses a selected 100/125/150 g allowance per guest, rounded up to 0.5 kg; the bakery confirms the final portions and design.

Baker Bot is a built-in browser guide with intent matching and website information. It is not connected to a live AI model, does not make AI API calls and does not store a chat transcript on the server.


Customer tools: the homepage cake quiz suggests gallery designs by occasion/style and estimates weight (guests × portion grams, rounded up to 0.5 kg). Budget is a customer preference, not a guaranteed price filter; the bakery quotes all designs. Choosing a result copies the plan into the enquiry.

Customer tracking: use the Track my order section with the saved enquiry reference and full original phone number (formatting spaces/dashes are ignored; country codes must match). POST /api/orders/track is same-origin, rate limited and returns only reference, status, accepted flag, message and update time. No personal details, private notes or images are returned. Confirmed/Baking/Ready/Completed are accepted; Awaiting advance is pending. Owner updates in the dashboard appear on the next lookup. Existing enquiries also work. Tracking details are sent in JSON, never URL parameters, and responses are not cached.
