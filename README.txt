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
