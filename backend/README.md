# Backend

The NestJS API for the Travel Planning and Booking Platform.

Setup, environment variables, seeding, the Swagger demonstration, the API overview and testing are all described in the [main README](../README.md).

Quick start, from this folder:

```bash
npm ci
cp .env.example .env      # then fill in MONGODB_URI, JWT_ACCESS_SECRET, ADMIN_*, STRIPE_SECRET_KEY
npm run seed:reference
npm run seed:admin
npm run start:dev         # Swagger UI at http://localhost:3000/api/docs
```
