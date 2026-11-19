# Phase 9 progress: payments and refunds

Source: official workbook PAY-01 to PAY-04, checked 2026-11-19. Stripe runs in **test mode** (a Stripe sandbox). Everything is in EGP minor units (piastres).

## Setup

In `backend/.env` (placeholders are in `.env.example`):

- `STRIPE_SECRET_KEY`: the sandbox secret key, `sk_test_…`, from https://dashboard.stripe.com/test/apikeys. Never use a live key.
- `STRIPE_WEBHOOK_SECRET` (optional locally): `whsec_…`. Install the Stripe CLI and run `stripe listen --forward-to localhost:3000/api/payments/webhook`; it prints the secret. When deployed, add the endpoint in the Stripe dashboard instead.

## Endpoints (travelers only, own bookings only)

| Endpoint                                       | Req    | What it does                                                                                                                                    |
| ---------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/bookings/:type/:id/policies`         | PAY-02 | `type` is `flight` or `hotel`. Airline: free/extra baggage and cancellation tiers per flight. Hotel: check-in/out times and cancellation tiers. |
| `POST /api/bookings/:type/:id/accept-policies` | PAY-02 | `{ "accept": true }` stores `policyAcceptedAt` while the hold lasts.                                                                            |
| `POST /api/payments`                           | PAY-01 | `{ bookingType, bookingId }` creates the Stripe PaymentIntent and returns `clientSecret` for Stripe Elements.                                   |
| `POST /api/payments/:id/retry`                 | PAY-01 | After a decline, while the hold lasts.                                                                                                          |
| `GET /api/payments/:id`                        | PAY-01 | Status, checked with Stripe.                                                                                                                    |
| `POST /api/payments/webhook`                   | PAY-01 | Called by Stripe only. Signature-checked, and hidden from Swagger.                                                                              |
| `GET /api/refunds/:id`                         | PAY-03 | Pending, Refunded or Failed, checked with Stripe.                                                                                               |

**Trying it in Swagger before the frontend exists:** add `"testPaymentMethod": "pm_card_visa"` to `POST /api/payments` or the retry. `pm_card_chargeDeclined` simulates a decline, which returns 402 with the `paymentId` to retry. This only works with an `sk_test_` key.

## Rules

- **Card details never reach the backend.** The frontend sends them straight to Stripe (Stripe Elements plus `clientSecret`). The `Payment` record stores only the Stripe PaymentIntent id, amount, currency and status. The client secret is never stored.
- **Payment requires** a Pending Payment booking with an unexpired hold and accepted policies. There is only one open (pending or failed) payment per booking, and a second request points to the retry endpoint. Each PaymentIntent is created with an idempotency key.
- **Confirmation only after Stripe reports success:** through the signed webhook (`payment_intent.succeeded`), or by asking Stripe directly. Marking the payment succeeded and confirming the booking happen in one transaction, through `confirmPaidBooking` or `confirmPaidReservation` from phases 6 and 8. Repeated webhooks change nothing.
- **Holds that end:** every 30 seconds, open payments whose booking is no longer payable have their PaymentIntent **cancelled at Stripe** (PAY-01). If Stripe reports success after the hold ended, the payment is recorded and **refunded in full** automatically; the booking stays Expired or Cancelled.
- **Refunds (PAY-03)** come from traveler cancellations (provider tiers), airline flight cancellations (100%) and late payments.
  - Every pending `Refund` is sent through the Stripe Refunds API with an idempotency key (`refund-<id>`), so a retry never refunds twice.
  - Statuses: `pending` → `refunded` (Stripe `succeeded`) or `failed` (Stripe `failed`/`canceled`). A finished refund never changes again.
  - The traveler gets a REFUND_UPDATED notification when it finishes.
  - Flight and hotel booking details show `refund: { id, amountMinorUnits, currency, status }`.
- **Single currency (PAY-04):** EGP, from `src/common/currency.ts`.
- **Tests never reach Stripe.** `test/setup-e2e.ts` clears the Stripe keys, and `payments.e2e-spec.ts` swaps in a fake Stripe. Webhook signatures still use Stripe's real signing code.

## Verification

- **Checks:** build, lint and formatting pass. 222 unit tests and 165 end-to-end tests pass (7 new payment tests on a local replica set).
- **Real Stripe sandbox run** through the app on a throwaway database:
  1. A hotel reservation was refused payment before its policies were accepted, then accepted.
  2. Stripe declined the card (402).
  3. The retry with a good test card succeeded; the reservation was confirmed with a reference.
  4. Cancellation created a 50% refund, sent to Stripe, which came back refunded, as the booking details showed.

  Stripe's API confirmed the succeeded 300,000 EGP-minor-unit PaymentIntent and the 150,000 refund.
