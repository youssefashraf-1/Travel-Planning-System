# Travel Planning System

Travel planning and booking management project. Development currently focuses on the NestJS backend for Milestone 1. The Next.js frontend is reserved for Milestone 2 and has not been created yet.

## Repository structure

```text
Travel-Planning-System/
├── backend/          # NestJS application and its dependencies
│   ├── src/
│   ├── test/
│   ├── .env.example  # Safe configuration template
│   └── .env          # Local configuration; ignored by Git
├── frontend/         # Placeholder only
└── README.md
```

Open this repository's top-level folder in VS Code so both folders appear in Explorer. Run Git commands from this folder; run backend npm commands from `backend/`.

## Backend setup

Install Node.js and npm, then run:

```bash
cd backend
npm ci
```

For a fresh clone, copy `.env.example` to `.env` and set `MONGODB_URI` to your MongoDB connection string. Keep an existing `.env` file unchanged. MongoDB must be reachable from your machine for the application to start.

```bash
npm run start:dev
```

The default address is `http://localhost:3000`. Set `PORT` in `.env` to change it. The existing root endpoint returns `Hello World!`.

Never commit `.env` or database credentials. `.env.example` contains only a local database example and blank optional monitoring settings. If enabling NestJS Observe, configure your own `OBSERVE_APP_KEY` and `OBSERVE_APP_SECRET` locally.

## Checks

Run these commands inside `backend/`:

```bash
npm run build
npm test -- --runInBand
npm run lint
```

The current unit tests cover the generated application, users service, and users controller scaffolding. They do not verify completed travel or authentication features. The existing end-to-end test imports the full application and requires a reachable MongoDB instance and runtime configuration:

```bash
npm run test:e2e
```

## Milestone 1 status

- NestJS application, environment loading, and MongoDB connection configuration are present.
- The users module and user schema are present.
- The users service and controller are scaffolds; user operations and authentication remain to be implemented.
- Travel and booking features remain to be implemented against the assignment requirements.
- `frontend/` contains only `.gitkeep` so Git preserves the placeholder directory.

Before starting new work, pull the latest changes and create a feature branch. Commit source changes and the relevant lockfile; keep credentials, dependencies, and generated build output out of Git.
