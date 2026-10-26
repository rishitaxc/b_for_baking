B FOR BAKING — BACKEND UPDATE

See README.md for complete setup and deployment instructions.

Run with Node.js 24 or newer:
node --env-file-if-exists=.env server.js

Website: http://localhost:8090/
Owner dashboard: http://localhost:8090/admin

First setup must be completed on localhost. Choose your own owner username and password (at least 12 characters). No default password has been set.

The backend saves website enquiries, preferred designs and custom illustrations. The owner can review enquiries, set quotes and manually record advances, update order statuses, see balances and export the visible order list.

Instagram insights show total website clicks and unique browsers that clicked. They do not identify Instagram accounts, confirm that Instagram loaded or count follows. Analytics use a random anonymous browser cookie and begin when this backend is used.

The database and visitor secret are stored privately in data/ and excluded from Git. No live customer data or login credentials should be uploaded to GitHub.

Public deployment requires Node hosting, HTTPS and persistent storage. GitHub Pages cannot run this backend. There is no connected payment gateway. Enquiries are not confirmed orders until the bakery confirms them.


Customer tools: the homepage cake quiz suggests gallery designs by occasion/style and estimates weight (guests × portion grams, rounded up to 0.5 kg). Budget is a customer preference, not a guaranteed price filter; the bakery quotes all designs. Choosing a result copies the plan into the enquiry.

Customer tracking: use the Track my order section with the saved enquiry reference and full original phone number (formatting spaces/dashes are ignored; country codes must match). POST /api/orders/track is same-origin, rate limited and returns only reference, status, accepted flag, message and update time. No personal details, private notes or images are returned. Confirmed/Baking/Ready/Completed are accepted; Awaiting advance is pending. Owner updates in the dashboard appear on the next lookup. Existing enquiries also work. Tracking details are sent in JSON, never URL parameters, and responses are not cached.
