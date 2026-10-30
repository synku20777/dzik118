# Local font evaluation

Checked 23 October 2026. This is an evaluation, not a decision to replace the current production fonts.

## Selected local typography

Medeo Sans is the selected UI face for local development as of 27 October 2026, replacing Neue Montreal. The regular and italic files are in `src/fonts/`. The comparison dropdown, file picker and alternate-family options remain removed.

- Regular text: weight **400**.
- Tracking: **0** (normal spacing).
- Existing medium/semibold/bold hierarchy and display typography remain.

`npm run dev` loads `src/fonts/MedeoSansVariable.woff2` and its italic companion automatically. Production keeps the existing fonts; the development preview does not change production typography. Medeo's license has not been reviewed here.

Test Latvian diacritics, Cyrillic, euro signs, decimal commas, small labels, bold headings and narrow tables. Retain the Cyrillic fallback until the actual font version's coverage has been checked: a current product page can describe a newer version than an existing trial file.

## Previous Pangram Pangram evaluation: license scope before production

- **Testing:** the foundry's FAQ includes development environments and proofing in its free trial examples. Treat the files found in Downloads as evaluation-only; their presence does not establish a commercial license.
- **Namkopa app:** the FAQ and EULA classify web applications under an App license, with coverage based on monthly active users.
- **Marketing website:** separate Web coverage depends on domains/subdomains and monthly pageviews. The FAQ's aggregation wording differs from the EULA's per-domain wording; confirm both website hosts in the quote.
- **Duration:** the FAQ describes annual company licenses and an indefinite individual/freelancer exception. The general EULA states a one-year term. Obtain the applicable term in the business's quote/order; do not assume a personal purchase covers the company indefinitely.
- **Other uses:** logo, social, advertising and print uses have their own categories. If invoice PDF typography is changed later, confirm document embedding rights too. The local font treatment changes browser UI only.
- **Purchase:** use the license-holding business's details, chosen families/styles, projected users/pageviews and intended uses. Pricing needs those selections; no price is assumed here.

Primary sources: [FAQ](https://pangrampangram.com/pages/faq), [EULA](https://pangrampangram.com/pages/eula). Keep the terms and receipt supplied with any purchase; EULA section 7.6 refers to the version in effect when the font was ordered.

## Previous family

[Neue Montreal](https://pangrampangram.com/products/neue-montreal) was previously previewed using a trial file. Purchase the appropriate commercial coverage if applying it to production.
