# Phase 2 database design

The schema and index definitions use the [official requirements workbook](https://docs.google.com/spreadsheets/d/17WYE0p9EHUn-GUDrtqtCAekhqecOX8H1/edit?gid=874030513) and the [provided reference datasets](https://docs.google.com/spreadsheets/d/1SlKUTRqlHuBJAMC-Z-QOZzSrzKpGHT_TgQUI5gVm-BA/edit). Individual model notes in this folder describe the field-level rules.

## Collection relationships

| Area | Relationships |
| --- | --- |
| Reference data | Country links to Currency. City links to Country. Attraction links to City. Airport links to City and Country and keeps its unique IATA code. Four reference collections use the source identifiers as MongoDB `_id` values. Airport keeps its existing MongoDB ID so flights can reference it. |
| Accounts | A user's preferred currency can link to Currency. A moderator's provider ID resolves to Airline or Hotel according to the role. |
| Flights | Flight links to Airline and two Airports. Cabin Inventory links to Flight. Flight Booking links to User and embeds the booked flight segments and passengers. Each segment links to Flight, Airline, and Cabin Inventory. |
| Hotels | Hotel links to City and Country. Room links to Hotel and has one Room Availability record. Hotel Booking links to User and Hotel and embeds the reserved rooms and their agreed terms. Review links to one completed Hotel Booking, its Hotel, and its author. |
| Payments | Payment links to a Flight Booking or Hotel Booking. Refund links to Payment. Booking amounts, payments, and refunds carry the platform currency code. |
| Itineraries and rates | Itinerary links to its owner and selected Countries. Itinerary days are ordered and embedded with activities, budget entries, and transport costs. Day and intercity transport IDs link to City. Budget currencies and the exchange-rate cache link to Currency. Itinerary clones keep the source itinerary and original author IDs. |
| Blog | Blog Post links to its author. Comment links to Blog Post and its author. Like links to Blog Post and User. |
| Supporting records | Notification links to its recipient and the event's related record. Report links to its reporter, content target, and resolving admin when present. Audit Log links to its actor, target, and optional originating Report. |

Mongoose references support loading related records. The feature services still check that referenced records exist and that they satisfy rules such as a room belonging to the booking's hotel. Where a record may be deleted, reports and audit entries retain the target ID for history.

## Indexes and uniqueness

| Constraint or lookup | Index |
| --- | --- |
| Account email and provider codes | Unique normalized email, airline code, and airport IATA code. |
| Account administration and moderator assignment | Role and status with creation time. Assigned provider and role. |
| Flight number and route search | Unique airline, flight number, and local departure date. A route, date, and status index supports flight search. Airport city and city country indexes support location lookups. |
| Cabin and room identity | Unique flight and cabin class, unique hotel and room label, and one availability record per room. Room labels ignore letter case within one hotel. |
| Booking and review identity | Unique references within each booking collection once assigned. One review per hotel booking. Booking indexes support user history, provider lookups, and finding expiring holds. |
| Payments, refunds, and exchange rates | Unique Stripe PaymentIntent ID, one successful payment per booking, and one cancellation refund per payment. One exchange-rate record per base currency and rate date. |
| Community and audit | One like per user and post, one report per reporter and target, and one notification per recipient and event. Additional indexes support public lists, moderation, unread counts, and audit history. |

Unique indexes guard concurrent writes once created in MongoDB. Booking inventory and availability require transactional updates when the services are implemented. Seed and application setup create defined indexes without dropping existing indexes.

## Reference data setup

From `backend/`, configure `MONGODB_URI` for the intended database and run `npm run seed:reference`. The command validates the bundled source rows before writing. It updates records by the original source identifier or IATA code, so reruns keep the same IDs, including those referenced by flights. It writes only the five reference collections. The seed does not create users, bookings, payments, or exchange-rate quotes.

The exchange-rate model stores the base currency, the provider's rate date, the retrieval time, and positive rates for the supported currencies. The budgeting service can use the latest cached rate date when fetching fails.
