# Cabin inventory, flight bookings and passengers

The requirement IDs below refer to the [official workbook](https://docs.google.com/spreadsheets/d/17WYE0p9EHUn-GUDrtqtCAekhqecOX8H1/edit?gid=874030513).

| Model | Data and relationships |
| --- | --- |
| Cabin Inventory (FLT-04, FLT-05, FLT-11, FLT-22) | One document per flight and cabin class. A unique index enforces that pair. The document holds capacity, held seats, booked seats, fare, free bag count and a per-bag weight limit. Availability equals capacity minus held and booked seats. |
| Flight Booking (FLT-12, FLT-21 through FLT-26, PAY-02, GEN-11) | One document per booking, linked to its user. It contains one outbound leg and an optional return leg, the hold deadline, booking status, currency, total and policy acceptance time. Each leg links to its flight, cabin inventory and airline and copies the fare and baggage and cancellation terms at booking time. One unique reference is assigned on confirmation. |
| Passenger (FLT-12, FLT-19, FLT-29) | Passenger records are embedded in the booking and store full name, birth date and passport or ID number. Each passenger has one selection per booking leg, in the same order as the booking legs. Each selection stores passenger type, fare, extra bag weights and fee. Keeping type per leg supports a birthday between departure and return. |

## Inventory and booking lifecycle

The Cabin Inventory model validates that held plus booked seats fit within capacity. In the booking flow, use a conditional update that checks available seats and a database transaction to reserve every leg and create the booking together. Use the same transaction boundary when moving held seats to booked, releasing an expired hold, or cancelling a confirmed booking. Use a status and expiry check to keep retries from releasing or converting the same hold twice. The expiry index helps find due holds. Keep expired bookings for their history.

The service will set the hold deadline to ten minutes after reservation. Confirmation requires verified payment, a policy acceptance timestamp, and a unique reference. Transitions allowed by GEN-11 are pending payment to confirmed or expired, then confirmed to completed or cancelled. The payment model can link to the booking ID when it is added.

## Passenger pricing and visibility

The model checks the total, enforces at least one adult per leg and no more infants than adults, and checks bag counts and weights against the policy stored on that leg. The booking service will check birth dates against the departure airport's local date, charge adults and children the full fare and infants 10%, and reserve seats only for adults and children. Amounts use integers in the platform currency's minor unit. The booking service will calculate passenger fares and extra bag fees from the stored terms before confirming the total.

Passport and ID numbers are excluded from default queries. List and moderator export responses should use explicit field lists and include only the information required for the task. For round trips, each moderator should see only the segment operated by their own airline.
