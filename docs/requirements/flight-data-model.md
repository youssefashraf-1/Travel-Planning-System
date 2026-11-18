# Flight data model

Each Flight document represents one scheduled occurrence and references one Airline and two Airport documents. The schema follows FLT-03, FLT-05, FLT-06, FLT-11 and FLT-30 in the [official workbook](https://docs.google.com/spreadsheets/d/17WYE0p9EHUn-GUDrtqtCAekhqecOX8H1/edit?gid=874030513).

| Field | Purpose |
| --- | --- |
| `airlineId`, `departureAirportId`, `arrivalAirportId` | Link the flight to its operator and to two distinct airports. |
| `flightNumber` | Flight identifier normalized to uppercase without spaces. |
| `departureAt`, `arrivalAt` | UTC instants. The arrival instant must be later than the departure instant. |
| `departureLocalDate` | The calendar date at the departure airport. A unique MongoDB index combines this date with the airline and flight number. |
| `status` | Scheduled, cancelled or departed. New records default to scheduled. |

The scheduling service will resolve both airport IDs against the seeded data and obtain the airline ID from the moderator's assignment. It will interpret each input time in its own airport's time zone and derive `departureLocalDate` from the departure airport's local time whenever the route or schedule changes. For example, 00:30 in Cairo can fall on the previous UTC calendar day, so the date used for duplicate prevention must be the Cairo date.

Creation and departure-time edits will check that the departure is in the future. Route and schedule edits should validate and save the document so checks that compare its fields run. The unique index handles simultaneous duplicate writes. Searches and booking eligibility will check both the scheduled status and the departure time. Cabin inventory is the next separate schema on the Phase 2 checklist.
