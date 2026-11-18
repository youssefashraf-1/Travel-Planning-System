# Notifications, reports and audit logs

The IDs below refer to the [official workbook](https://docs.google.com/spreadsheets/d/17WYE0p9EHUn-GUDrtqtCAekhqecOX8H1/edit?gid=874030513).

| Model | Fields and constraints |
| --- | --- |
| Notification (GEN-01, ACC-15) | Stores the recipient, event type, related record, title, message, and read timestamp. A new notification is unread. A unique recipient and event key pair prevents creating the same notification twice when an event is retried. |
| Report (GEN-09, GEN-10) | Links a reporter to a post, comment, review, or itinerary and records their reason. A unique index limits each reporter to one report per item. Reports start open. Dismissal, hiding, and deletion each record the resolving admin and time. |
| Audit Log (GEN-07, GEN-10) | Records the admin, action, affected record, and creation time, with an optional originating report. Account and provider changes, content moderation, and report dismissal have specific action types. Entry fields are immutable in Mongoose. |

- Use a stable event key for each occurrence and recipient. Two separate flight schedule changes need different keys. Count unread notifications by recipient and a null read timestamp. Scope the mark-as-read update to the signed-in recipient.
- Derive report and audit actors from the signed-in user. The moderation service will check the admin role, require an open report for resolution, and write the resolution and related content or audit changes together. When a target is deleted, keep its type and ID on reports and audit entries for history.
- Use insert-only operations for audit entries and restrict access to admins. Application database permissions can enforce the insert-only rule. Keep passwords, payment details, and other secrets out of audit entries and notification messages.
