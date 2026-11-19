# Integration fixes — 19 November 2026

Closes the three issues reproduced in the develop 385e186 review.

## Provider cancellation and Stripe cleanup

Previously, flight cancellation marked a local payment cancelled and the
payment sweep then ignored it. The sweep now includes cancelled records until
Stripe cancellation/success has been reconciled. An optional Payment field,
`stripeReconciledAt`, records that terminal remote verification or a durable
refund record exists. Legacy rows without the field are included automatically;
no index changes, bulk migration or manual database edits are needed.

A Stripe success found after the booking was cancelled/expired queues a full
refund. Network failures leave the row unresolved for a later sweep. Once a
remote cancellation is confirmed, polling stops. A cursor prevents a fixed
first page of still-payable payments from starving cancellations behind it.
GET payment status also reconciles legacy cancelled rows.

## Duplicate payment creation/capture

Payment creation uses one stable Stripe idempotency key per booking hold,
instead of an attempt count read before insertion. The same booking's retries
reuse that intent. Concurrent create requests converge on one Stripe intent
and one local Payment; a losing local insertion returns 409 with the retry
endpoint instead of a duplicate-key 500.

For legacy data with more than one captured intent, only the specific
succeeded-per-booking unique-index error enters refund recovery. An equality
upsert under the existing Refund.paymentId unique index guarantees one refund
record; Stripe's refund idempotency key prevents double payouts. The refund
record is persisted BEFORE the extra attempt is marked reconciled, allowing
crash/retry recovery. Repeated simultaneous success deliveries converge on the
same refund and preserve the original confirmed booking.

The existing index continues to reserve the local `succeeded` slot for one
payment per booking. A legacy extra capture may therefore retain its previous
local status, with stripeReconciledAt and its linked Refund recording its
resolution. GET /api/payments/:id presents a captured attempt as succeeded and
includes an optional `refund: { id, amountMinorUnits, currency, status }` for
that exact payment. It never returns a client secret or allows a retry of a
reconciled/refunded attempt.

## Hotel-local account deactivation

The account guard now compares the confirmed reservation's local checkout
(date plus stored policy time) with the hotel's local current time, matching
hotel completion semantics. It blocks before checkout and permits deactivation
at/after checkout, unless another upcoming confirmed booking blocks it.
Legacy confirmed rows missing checkout metadata block conservatively rather
than causing a 500 or bypassing the guard.

## Verification

- New regression tests first reproduced the old failures.
- Build, lint, Prettier and git diff --check pass.
- 238 unit tests and 179 e2e tests pass against disposable local MongoDB.
- Tests cover eight concurrent creation requests, four simultaneous duplicate
  success deliveries, legacy cancellation cleanup, late captured refunds,
  timezone midnight boundaries, exact checkout and missing legacy metadata.
- Original audit probes were rerun against the built code: cancellation now
  reaches Stripe, an extra capture has one refund and no duplicate-key error,
  and the hotel-local guard blocks the upcoming stay.
- Stripe tests use a fake gateway; no real Stripe charges/refunds or shared
  Atlas records were touched. Sandbox credentials are still a local setup
  prerequisite for real Stripe verification.
