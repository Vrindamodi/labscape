# Payments (Razorpay Subscriptions)

LABscape bills Premium through **Razorpay Subscriptions**. There are two modes, chosen with
`BILLING_MODE`:

| Mode | What happens |
| --- | --- |
| `sandbox` (default) | No money moves. The Plans page shows a test sheet whose "Pay" button sends the same signed webhook Razorpay would. The app runs with no keys. |
| `razorpay` | Real Razorpay Checkout. The API refuses to start if any setting below is missing. |

## Environment variables (API)

| Variable | Example | Notes |
| --- | --- | --- |
| `BILLING_MODE` | `razorpay` | `sandbox` or `razorpay`. |
| `RAZORPAY_KEY_ID` | `rzp_test_1234abcd` | Dashboard → Account & Settings → API Keys. Sent to the browser for Checkout. |
| `RAZORPAY_KEY_SECRET` | *(secret)* | Server only. Used for API calls (Basic auth) and to verify the Checkout signature. Never logged. |
| `RAZORPAY_WEBHOOK_SECRET` | *(secret you choose)* | The secret typed into the dashboard webhook. Must not be the dev default. |
| `RAZORPAY_PLAN_PREMIUM_MONTHLY` | `plan_N1abc...` | Razorpay plan id for Premium Monthly. |
| `RAZORPAY_PLAN_PREMIUM_ANNUAL` | `plan_N1xyz...` | Razorpay plan id for Premium Annual. |
| `RAZORPAY_BASE_URL` | `https://api.razorpay.com/v1` | Optional; tests point it at a local stub. |
| `RAZORPAY_TIMEOUT_SECONDS` | `15` | Optional request timeout. |

The matching Spring keys are `labscape.billing.mode`, `labscape.billing.razorpay-key-id`,
`labscape.billing.razorpay-key-secret`, `labscape.billing.webhook-secret`,
`labscape.billing.razorpay-plans.premium_monthly`, `labscape.billing.razorpay-plans.premium_annual`,
`labscape.billing.razorpay-base-url` and `labscape.billing.razorpay-timeout-seconds`.

Test keys (`rzp_test_...`) and live keys (`rzp_live_...`) each have their **own** plans and webhooks:
create both sets separately in test mode and live mode.

## 1. Create the plans

Dashboard → Subscriptions → Plans → **Create Plan** (do this in test mode first, then again in live mode):

| LABscape plan | Billing frequency | Amount (INR, GST inclusive) |
| --- | --- | --- |
| Premium Monthly | Every 1 month | ₹149 |
| Premium Annual | Every 1 year | ₹999 |

The amounts must match the prices in `Billing.PLANS` (the page shows those). Copy each `plan_...` id
into the env vars above. LABscape creates each subscription with `total_count` 120 (monthly) or 10
(annual), about ten years, and stores our user id in the subscription `notes`.

## 2. Add the webhook

Dashboard → Account & Settings → Webhooks → **Add New Webhook**:

- **URL:** `https://<your-api-host>/v1/billing/webhook`
- **Secret:** a long random string; put the same value in `RAZORPAY_WEBHOOK_SECRET`.
- **Active events:**
  - `subscription.authenticated`
  - `subscription.activated`
  - `subscription.charged`
  - `subscription.pending`
  - `subscription.halted`
  - `subscription.cancelled`
  - `subscription.completed`
  - `payment.failed`

The endpoint needs no session and is exempt from the CSRF origin check; it verifies
`X-Razorpay-Signature` (HMAC-SHA256 of the raw body with the webhook secret) and processes each
`X-Razorpay-Event-Id` once, so Razorpay's retries are safe.

## How a purchase flows

1. `POST /v1/billing/checkout {plan}` creates a Razorpay subscription (`POST /subscriptions`) and
   stores it as `pending`. The response carries `subscriptionId`, `razorpayKeyId` and `prefill`.
2. The Plans page loads `checkout.js` and opens Checkout with that `subscription_id`.
3. On success, the page sends the handler response to `POST /v1/billing/verify`. The server checks
   `HMAC-SHA256(payment_id + "|" + subscription_id, key_secret)` and switches Premium on
   provisionally.
4. Webhooks are the source of truth: `subscription.activated` / `subscription.charged` set the real
   period end (`current_end`) and write the GST invoice; failures, halts and cancellations follow.

| Razorpay event | LABscape status | Premium? |
| --- | --- | --- |
| `subscription.authenticated` | `authenticated` | not yet |
| `subscription.activated` | `active` (period end from Razorpay) | yes |
| `subscription.charged` | `active` + invoice | yes |
| `subscription.pending`, `payment.failed` (renewal) | `grace` (3 extra days) | yes |
| `subscription.halted` | `halted` | no, until a later charge succeeds |
| `subscription.cancelled`, `subscription.completed` | `cancelled` | until the paid period ends |

**Cancel** (`POST /v1/billing/subscription/cancel`) calls Razorpay
`POST /subscriptions/{id}/cancel` with `cancel_at_cycle_end=1`; Premium stays on until the period
ends. Razorpay cannot undo a scheduled cancel, so **resume** returns `409 RESUME_NOT_SUPPORTED` in
Razorpay mode. A user with live Premium cannot start a second subscription (`409 ALREADY_SUBSCRIBED`).

## Testing with Razorpay test mode

1. Switch the dashboard to **Test Mode**, generate test API keys, create the two plans and the
   webhook as above.
2. Expose your local API so Razorpay can reach the webhook, for example
   `cloudflared tunnel --url http://localhost:8080` or `ngrok http 8080`, and use that URL in the
   test-mode webhook.
3. Run the API with:

   ```sh
   BILLING_MODE=razorpay
   RAZORPAY_KEY_ID=rzp_test_...
   RAZORPAY_KEY_SECRET=...
   RAZORPAY_WEBHOOK_SECRET=...
   RAZORPAY_PLAN_PREMIUM_MONTHLY=plan_...
   RAZORPAY_PLAN_PREMIUM_ANNUAL=plan_...
   ```

4. Sign in with a full (non-guest) account, open **Plans** and subscribe. Use Razorpay's
   [test cards](https://razorpay.com/docs/payments/payments/test-card-details/) (cards that support
   recurring payments / e-mandates) or test UPI ids such as `success@razorpay` / `failure@razorpay`.
5. Check Dashboard → Webhooks → the webhook's delivery log; each delivery should get `200`.
   Billing history on the Plans page shows the invoice once `subscription.charged` arrives.

Automated tests (`RazorpayBillingTest`) run the whole flow against a local stub of the Razorpay
API and never touch the network.
