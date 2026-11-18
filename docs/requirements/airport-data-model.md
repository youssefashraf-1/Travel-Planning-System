# Airport data model

The Airport model follows FLT-02, FLT-03, GEN-06, and GEN-12 in the [official requirements](https://docs.google.com/spreadsheets/d/17WYE0p9EHUn-GUDrtqtCAekhqecOX8H1/edit?gid=874030513) and the Airports.csv tab in the [reference data](https://docs.google.com/spreadsheets/d/1SlKUTRqlHuBJAMC-Z-QOZzSrzKpGHT_TgQUI5gVm-BA/edit).

| Reference column | Model field |
| --- | --- |
| `iata_code` | `iataCode`, a unique three-letter code stored in uppercase. |
| `name` | `name`, the airport display name. |
| `city_id` | `cityId`, the identifier from Cities.csv. |
| `country_code` | `countryCode`, the two-letter identifier from Countries.csv. |
| `time_zone` | `timeZone`, a named IANA time zone such as `Africa/Cairo`. |

Flights will reference the departure and arrival airport documents. Resolve each airport from the seeded list before accepting a flight or search request. Flight times are stored in UTC and displayed using the respective airport's time zone. Several airports can share the same city ID.

The reference-data seed should upsert airports by IATA code, keep their source city and country identifiers, and verify that the city belongs to the specified country. Seed execution and the read-only airport endpoint are later steps.
