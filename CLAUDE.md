# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Scope of context

The context for this project is **paybull only**. Reading other projects is forbidden
**from any directory**
anywhere on the filesystem. This holds regardless of the reason: "check the established
convention", "copy a structure", "compare versions" — all out of bounds. Other codebases
have different stacks and different decisions; importing them here turns a guess into an
apparent fact.

Allowed sources of context, and nothing else:

- this repository;
- its knowledge base and worklogs (cc-memory workspace `paybull`);
- this project's agent memory;
- what the user tells you.

Searching the codebase must always be scoped to this project's directory. The only
exception is the project's own infrastructure — `node_modules/` inside this repo and
`npm view` / `npm ls` output are dependencies, not other projects.

Never guess or invent requirements. When a request is ambiguous, ask and **wait** for an
answer instead of picking a reasonable-looking default. Structural choices the user has
not made belong in "Not yet decided" below — do not fill them in on their behalf.

## No comments in code

Do not leave comments in `.ts` files — **none at all**: no `//`, no `/* */`, no JSDoc `/** */`.
Comments drift out of sync with the code on the first edit and become misinformation.

If a line seems to need explaining, rewrite it so it doesn't: a named function, a named
constant, a clearer identifier. Anything that still needs saying goes somewhere that stays
true — a test that pins the behaviour, or this file for a project-wide rule and for external
constraints (version incompatibilities, library quirks).

This covers code only. `.env.example` and markdown keep their prose.

## Project

NestJS 11 HTTP API. TypeScript, TypeORM + PostgreSQL, configuration via `@nestjs/config`,
request validation via `class-validator` / `class-transformer`.

## Commands

```sh
npm i                # install; must resolve with no --force / --legacy-peer-deps
npm run build        # nest build → dist/ (dist/main.js at the root of dist)
npm run start:dev    # watch mode
npm run start:prod   # node dist/main
npm run lint         # eslint, flat config (eslint.config.mjs)
npm test             # jest — unit/*.spec.ts under src/
npm run test:e2e     # jest --config ./test/jest-e2e.json
```

### Toolchain constraints

- **TypeScript stays on 6.x.** Do not bump to 7 — `@typescript-eslint` (`>=4.8.4 <6.1.0`)
  and `ts-jest` (`>=4.3 <7`) do not support it yet; the bump breaks lint and tests.
- ESLint 10 reads **only** the flat config `eslint.config.mjs`. Do not add `.eslintrc.*`.
- `tsconfig.json` needs explicit `rootDir` and explicit `types: ["node", "jest"]` — TS 6
  requires `rootDir` on emit configs and no longer auto-includes `@types/*`. `baseUrl` is
  deprecated; do not reintroduce it.
- `tsconfig.build.json` sets `rootDir: "./src"` so the build emits `dist/main.js`, not
  `dist/src/main.js`. `start:prod` depends on this.
- **`incremental` must stay `false`.** `nest-cli.json` sets `deleteOutDir: true`, so every build
  wipes `dist/`; with `incremental: true` tsc then trusts `tsconfig.build.tsbuildinfo`, considers
  unchanged files already emitted, and skips them — leaving a **partial `dist/` with exit code 0**
  (only the files touched since the last build). `start:prod` breaks and nothing warns you. If you
  re-enable it, you must also drop `deleteOutDir`. Check a build by the emitted files, not just the
  exit code.
- Do not run `npm audit fix --force` — it downgrades `@nestjs/cli` to 6.x. The reported
  high-severity advisories are a single transitive `brace-expansion` DoS reached only
  through dev tooling (`@nestjs/cli`, `eslint`, `jest`, `ts-jest`); it is absent from the
  production dependency tree. Do not override `brace-expansion` to 5.x either: v5 returns
  `{ expand }` from `require()` while `minimatch` calls the export directly, which breaks
  glob, and with it jest and `nest build`.

## Configuration & environment

`ConfigModule` is registered globally (`isGlobal: true`, `cache: true`) in `AppModule`, so
`ConfigService` is injectable anywhere without re-importing the module. Read configuration
through `ConfigService` — not `process.env` — everywhere except `main.ts`'s own bootstrap
needs.

Every variable is validated at boot by `src/common/config/env.validation.ts` (a
`class-validator` schema, no extra dependency). **An invalid or missing variable aborts
startup** with a message naming each offending variable; there is no silent fallback.
Values arrive typed: `PORT`/`DB_PORT` as numbers, the `DB_*`/`CORS_*` flags as real
booleans (`'false'` and `'no'` do not become `true`).

`.env.example` is the source of truth for the variable set — add a variable to the schema
and to the example in the same change. `.env` is git-ignored.

## Database

PostgreSQL via TypeORM, registered with `TypeOrmModule.forRootAsync` + `ConfigService`.

`autoLoadEntities: true` is deliberate: there is **no central entity list**. Each module
registers its own entities with `TypeOrmModule.forFeature()` and they are picked up from
there — which is what keeps entity ownership (below) enforceable.

`DB_SYNCHRONIZE` is env-driven and **false by default**. It lets TypeORM rewrite the schema
to match the entities on boot; never enable it outside local development.

## HTTP layer

Set up in `main.ts`:

- **Global validation** — `ValidationPipe` with `whitelist: true`, `forbidNonWhitelisted: true`,
  `transform: true`. Unknown properties in a payload are an error, not silently dropped, and
  DTOs arrive as real class instances. Every endpoint's input therefore needs a DTO.
- **CORS** — driven by `CORS_ORIGIN` (empty = disabled, `*` = any, otherwise a comma-separated
  list) and `CORS_CREDENTIALS`. `*` together with credentials does not work — browsers reject it.
- **Client IP** — Express `trust proxy` from `TRUST_PROXY` (`false` | `true` | hop count |
  e.g. `loopback`). Required for `req.ip` to hold the real client address behind a proxy;
  without it you get the proxy's address.

## API documentation (Swagger)

`@nestjs/swagger` serves the UI at **`/api`** and the OpenAPI JSON at `/api-json`.

It is **only mounted when `NODE_ENV !== 'production'`** — in production both paths return 404,
so the API surface is not published. Do not make it unconditional.

## Architecture: module boundaries

The project is built **modularly**. Each feature is one self-contained NestJS module that
owns everything it needs:

```
src/<module>/
  <module>.module.ts
  <module>.controller.ts     # HTTP layer only
  <module>.service.ts        # business logic
  dto/                       # its own validation (class-validator DTOs)
  types/                     # its own types
  entities/                  # its own entities
```

Modules must be as **independent of each other as possible**. Design a new module so that
it can be understood, tested, and changed without opening another module's code.

### Entity ownership (hard rule)

**Using another module's entity is forbidden.** An entity belongs to exactly one module.
Never import, query, or inject the repository of an entity owned by a different module.

When module A needs an operation on an entity owned by module B:

1. Add a service method **in module B** and put the logic there — B owns its data and the
   rules around it.
2. B exports its service; A imports B's module and calls that method.

In practice: only the owning module registers its entity with `TypeOrmModule.forFeature`,
and only that module injects the corresponding repository. Business logic about an entity
lives next to the entity, never in a consumer.

## `src/common/`

Shared solutions live in `common/`, so they are written once instead of being duplicated
per module. What belongs there:

- **Response shaping** — one uniform envelope for all responses.
- **Guards** used by more than one module.
- **Decorators.**
- **Base classes** that modules extend — e.g. a pagination DTO, shared validation bases.

`common/` holds cross-cutting infrastructure only. Feature/business logic never goes here;
it belongs to the module that owns it.

### Response envelope

All responses are wrapped in a single consistent shape. **For now that shape is:**

```json
{ "data": ... }
```

Implemented by `ResponseEnvelopeInterceptor`
(`src/common/interceptors/response-envelope.interceptor.ts`), registered globally in `main.ts`.
Controllers return their payload plain — never wrap by hand, or you get `{ data: { data: … } }`.

Only the **success path** is enveloped. Thrown exceptions are handled by exception filters and
bypass the interceptor, so error responses keep Nest's default shape; unifying them is still
undecided.

A richer envelope (for example `{ timestamp, body }`) is the eventual direction, but it is
**not** the current contract — do not implement it until it is decided. Ask before changing
the envelope.

Swagger does not follow the envelope on its own: `@ApiOkResponse({ type: Dto })` documents the
bare DTO while the endpoint actually returns `{ data: Dto }`. Use `ApiEnvelopeResponse`
(`src/common/decorators/api-envelope-response.decorator.ts`) instead — it registers the model
with `ApiExtraModels` and documents the wrapped shape:

```ts
@Get()
@ApiEnvelopeResponse(UserDto, { isArray: true })
findAll() {}

@Post()
@ApiEnvelopeResponse(UserDto, { status: HttpStatus.CREATED })
create() {}

@Delete(':id')
@ApiEnvelopeResponse()
remove() {}
```

Omitting the model documents `{ data: null }`. Options: `status` (default 200), `description`,
`isArray`.

## Not yet decided — ask, do not assume

- Whether module directories sit directly under `src/<module>/` or under `src/modules/<module>/`.
- Exact filenames/layout inside a module beyond the roles listed above (`dto/` vs `validation/`,
  singular vs plural directory names).
- The final response envelope (see above) and whether errors share it. The `{ data }`
  interceptor is **not written yet** — nothing wraps responses at the moment.
- Migrations: whether schema changes go through TypeORM migrations (and where they live) or
  stay on `DB_SYNCHRONIZE` locally. Only the `synchronize` flag exists today.
- Whether `src/common/{config,interceptors,decorators}/` are the right homes for what is in
  them — they were placed there as cross-cutting infrastructure; confirm or move.
