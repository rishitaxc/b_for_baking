# b_for_baking

Pastel pink website for B for Baking, Shillong, with occasion galleries, a custom cake designer and WhatsApp order enquiries.

## Features

- 20 photos each for wedding, birthday and baby-celebration collections.
- Occasion and style filters, photo browsing and original Instagram post links.
- Live cake designer with shape, tiers, colours, decorations and a personal message.
- Downloadable design image and preferred-design selection.
- Guest-based cake-weight estimate and WhatsApp enquiry.
- Responsive desktop and mobile layouts.
- Baker Bot: a built-in conversational page guide for collections, styles, customisation, weight estimates and enquiries.

The baby collection includes baby showers, gender reveals and welcome-baby cakes. Some photos are alternate views of the same design; 20 photos does not mean 20 distinct designs.

## Run

Open `index.html`, or serve this folder with any static web server. There are no dependencies or build steps.

## Publish

Upload the website files, including `baker-bot.js`, and `assets/` folder to a static host. GitHub Pages can serve this repository from its `main` branch and root directory once enabled in repository settings.

## Baker Bot

Baker Bot runs in the browser using built-in website information and intent matching. It is not connected to a live AI model and makes no AI API calls. It can guide visitors to sections, filter cake collections, estimate weight from a guest count and carry occasion/guest details into the enquiry form. It directs pricing, availability, dietary and payment questions to the bakery. Conversation state lasts for the current page session and is not saved to a server.

## Orders

Enquiries are prepared for the bakery's WhatsApp number. Customers must send the message themselves. The website currently has no order database, admin dashboard or connected payment gateway. Payments and order confirmation are handled directly by the bakery.

The weight calculator uses a selected portion allowance and rounds up to the next 0.5 kg. The bakery confirms actual portions, weight, design, availability and pricing.

## Photos

Photos and business details come from [@b_for_baking](https://www.instagram.com/b_for_baking/), used at the website owner's request. Original post references are in `photo-sources.json`. Photos are not provided as a general-purpose image library.

See `README.txt` for detailed operating and editing notes.
