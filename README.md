# 🚀 Upwork Accelerator — In-Feed Intelligence Pro

Chrome extension that adds client hire rates and in-feed insights to Upwork job listings.

Upwork Accelerator helps freelancers evaluate job opportunities quickly, reduce scrolling, and make more informed decisions before spending Connects.

## ⚠️ Disclaimer & User Responsibility

Upwork Accelerator is an **independent, third-party browser extension** and is not affiliated with or endorsed by Upwork.

The extension has been designed with the intention of avoiding actions that may violate Upwork's policies, including automated bidding, messaging, clicking, or background activity. However, **no guarantee is made that its use complies with Upwork's current policies or that an account will not be restricted, suspended, or otherwise affected.**

By using this extension, **you are solely responsible for your own use of the extension and any consequences that may result, including account limitations or suspension.**

Please review Upwork's current Terms of Service and applicable policies before using the extension.

## Features

* ⚡ Fast in-feed job insights
* 🎯 Client Hire Rate visibility
* 🎨 Smart visual indicators
* 🟢 Minimal, unobtrusive UI
* 🔵 Active pulse indicator
* ⚙️ Built-in **About** & **Settings**
* 💾 Session-level caching

## 🚀 Performance

Optimized for approximately **0.5 sec response time** when the required information is already available on the page.

* Local DOM inspection
* Minimal network activity
* Session caching
* No unnecessary polling or page refreshes
* Event-driven processing

## Debugging hire-rate detection

Open the browser console on an Upwork page and filter for `[Upwork Accelerator]`. Each hover logs the detected Job ID, each permitted source checked, the selected source and hire rate, or the exact extraction-failure reason. The extension checks the feed card first, then the normal same-origin job-detail document available to the current browser session; it does not call private APIs or bypass authentication.

## 🔒 Privacy

Processes relevant page information locally whenever possible and avoids unnecessary data collection.

## 🛠️ Technology

**Manifest V3 · JavaScript · HTML · CSS · Browser Extension APIs**

## Version

**v1.0.0**

## Developer

**Suleman Sadat**

## License

Copyright © 2026 Suleman Sadat. All rights reserved.
