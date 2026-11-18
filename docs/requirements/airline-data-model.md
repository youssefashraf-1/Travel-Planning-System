# Airline data model

The IDs below refer to the [official workbook](https://docs.google.com/spreadsheets/d/17WYE0p9EHUn-GUDrtqtCAekhqecOX8H1/edit?gid=874030513).

| Requirement | Airline data |
| --- | --- |
| FLT-01, GEN-08 | Profile name, code, and optional URL for the airline's single logo. Codes are trimmed, uppercased, and unique so the same code identifies one airline. |
| ACC-15, FLT-11 | An active flag defaults to true. Search and booking services will check it before offering an airline's flights. Confirmed bookings remain valid when a provider is deactivated. |
| FLT-08 | Optional extra baggage policy with price per bag and maximum bags per passenger. The price is a positive integer in minor units of the platform currency (for example, cents), and the limit is a nonnegative integer. Weight comes from the flight cabin's free baggage allowance. |
| FLT-09 | Cancellation tiers with distinct nonnegative whole-day thresholds and refund percentages from 0 to 100. The cancellation service will choose the highest threshold that fits the days remaining or use 0% when no tier fits. |

An airline owns its policy settings, so they live in its document. A Flight will reference the airline's ID. An airline moderator's account will point to that same ID. Keep the policy terms accepted for a booking with that booking so later profile edits do not replace the accepted terms.

The model stores the profile and rules. Admin creation, moderator authorization, logo validation, search filtering, and refunds are implemented in their respective feature steps.
