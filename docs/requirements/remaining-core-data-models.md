# Hotel, payment, itinerary and blog data models

The requirement IDs refer to the [official workbook](https://docs.google.com/spreadsheets/d/17WYE0p9EHUn-GUDrtqtCAekhqecOX8H1/edit?gid=874030513).

| Model | Fields and relationships |
| --- | --- |
| Hotel (HTL-01, HTL-02, HTL-09, HTL-10) | Stores the profile, seeded city and country IDs, photos and amenities, active state, and optional policy settings. Hotel time zones give local check-in and check-out times a meaning. |
| Room (HTL-03, HTL-05, HTL-06) | Links to a hotel. Room labels are unique within the hotel regardless of letter case. Stores beds, occupancy, active state, and nightly price in minor units. |
| Room Availability (HTL-04, HTL-06, HTL-08) | One document per room with separate bookable and blocked date ranges. Ranges use an inclusive start and exclusive end. A block can cover part of a bookable window. |
| Hotel Booking (HTL-16 through HTL-22, PAY-02) | One reservation links a user and hotel to one or more rooms for a shared stay. Stores each room's booked price and occupancy, the hotel's time zone and agreed policy, status, hold deadline, and policy acceptance. The total is the sum of booked prices multiplied by the number of nights. |
| Review (HTL-23, HTL-24, GEN-10) | Links a hotel, author and completed reservation. A unique booking ID limits each reservation to one rating or review. Rating is an integer from 1 to 5. Public aggregates and review lists should use the same visibility filter. |
| Payment (PAY-01, PAY-04) | Links a unique Stripe PaymentIntent ID to either booking model. A partial unique index allows one successful payment per booking. Amounts and currencies can be checked against the reservation when processing Stripe events. |
| Refund (PAY-03, PAY-04) | One cancellation refund record per payment, with amount, currency, state and Stripe refund ID when available. Retries update the same logical refund. |
| Itinerary and Day (ITN-01, ITN-03, ITN-05, ITN-07 through ITN-09, ITN-20, ITN-21) | An itinerary has an owner, seeded countries, start date, up to 60 days, and private visibility by default. Days are embedded and ordered. Derive dates and day numbers from the start date and array position. Clones copy the full day content and keep the original author and source IDs. |
| Activity, Budget Entry, Transport Cost (ITN-10, ITN-12, ITN-14, ITN-16, ITN-18) | Embedded inside the applicable day, with their own IDs. Activities can have an optional local time and cost. Budget entries and transport costs store amounts and currencies. The service will calculate totals and convert amounts using the exchange rate for the chosen display currency. |
| Blog Post, Comment, Like (BLG-01 through BLG-10, BLG-12, GEN-10) | Posts store their author, publishing state, publication time, tags, and images. Comments and likes reference a post and user separately so a post can have many of either. A compound unique index enforces one like per user per post. Posts, comments, reviews, and itineraries track when an administrator hides them. |

## Rules for the later services

- Create a room and its availability record together. In reservation, schedule, and room deactivation transactions, acquire write ownership of each affected availability record by incrementing its version in a consistent room order. Recheck room state, blocked windows, active holds, and confirmed stays inside the same transaction before writing the booking. Retry transaction conflicts. This gives concurrent requests a shared document to contend on even when their new booking records differ.
- Check that all booked room IDs belong to the selected hotel. Keep expired holds for history. Reservation lifecycle and check-in date validation depend on booking status, the current time, and the hotel's local calendar.
- Only the booking owner can submit a review after their reservation reaches completed. Derive hotel and author IDs from the reservation and session. Derive average ratings and counts from the visible review records.
- Set booking references and confirm reservations only after verifying the payment event. Guard Stripe payment and refund calls with idempotency keys. The unique database indexes protect local records. Keep card details with Stripe.
- Use the seeded city, country, and supported currency records when validating requests. Check itinerary ownership before editing an embedded day, activity, budget entry, or transport cost. Copy the embedded content when cloning so future edits to the source or clone stay independent.
- Apply post, comment, review, and itinerary visibility and ownership rules in the services. The upload service checks file type and size, and the models enforce the image count. Compute blog interaction counts from comments and likes when listing or searching posts.
