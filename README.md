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
├── AI_PROMPTS.txt    # Record of material AI assistance
└── README.md
```

Open this repository's top-level folder in VS Code so both folders appear in Explorer. Run Git commands from this folder; run backend npm commands from `backend/`.

## Backend feature folders

```text
backend/
├── src/
│   ├── main.ts                    # Starts the application
│   ├── app/                       # Root application module and greeting endpoint
│   │   ├── app.module.ts
│   │   ├── app.controller.ts
│   │   ├── app.controller.spec.ts
│   │   └── app.service.ts
│   └── users/                     # User feature
│       ├── users.module.ts
│       ├── users.controller.ts
│       ├── users.controller.spec.ts
│       ├── users.service.ts
│       ├── users.service.spec.ts
│       └── schemas/
│           └── user.schema.ts
└── test/                          # Application-level end-to-end tests
```

Keep each feature's module, controllers, services, unit tests, and schemas in that feature's folder. Add `dto/`, guards, or other supporting files inside the feature when needed. Add new feature folders, such as `auth/`, `flights/`, and `hotels/`, when their implementation begins.

`src/main.ts` is the application entry point. The root module in `src/app/app.module.ts` loads environment configuration, connects MongoDB, and imports feature modules. Application-level end-to-end tests stay in `backend/test/` because they exercise the assembled application.

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

Before starting new work, pull the latest `develop` changes and create a feature, fix, refactor, or documentation branch. Open a pull request into `develop` for team-leader review; merge milestone releases from `develop` into `main`. Commit source changes and the relevant lockfile; keep credentials, dependencies, and generated build output out of Git. Record material AI assistance in `AI_PROMPTS.txt` throughout development.
