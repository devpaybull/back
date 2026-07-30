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
npm test             # jest — *.spec.ts under src/, rootDir is src/
```

Tests live in **`src/<module>/tests/`** — one `tests/` directory per module, holding the specs
for everything that module owns (services, controllers, DTOs, utils). `src/common/tests/` does
the same for `common/`. The name of a spec is the name of what it covers
(`user-profile.service.spec.ts`, `can-issue-role.spec.ts`), so the mapping stays obvious without
the files sitting next to each other.

The `test:e2e` script still exists in `package.json` but there is **no e2e suite**: `test/` is
empty and `test/jest-e2e.json` was removed, so the script fails. Either bring the config back
with a real suite or drop the script — do not cite it as if it ran.

### What a green test proves, and what it does not

The `src/users/` specs run against an **in-memory fake repository**
(`createFakeRepository`, `src/users/tests/fake-repository.spec.ts`) that reimplements the part of
TypeORM the services use: `findOne` / `findAndCount` / `create` / `merge` / `save` / `delete`,
the `In` · `Not` · `IsNull` · `ILike` operators, multi-condition `where` arrays, ordering by
several fields, `skip`/`take` paging and the count. Its `save` hands a row without an id a fresh
`randomUUID()`, the way the `users` table's default does. It is itself tested — the same file has
a `describe` block pinning its matching, escaping, ordering and paging — because a fake nobody
tests is a second implementation that silently disagrees with the first.

Ids in the specs come from `uuidOf(n)` (`src/common/tests/uuid-of.spec.ts`), a fixture that turns
a small number into a uuid-shaped value so a test can say "user 1" and still hand the code the
kind of string the column holds. It lives in `common/` and is tested for the same reason the fake
repository is.

Be clear about what that buys. A green users spec proves the service **calls the repository
correctly**: the right conditions, the right order, the right page. It does **not** prove
Postgres agrees. Nothing here has been checked against a real database — the fake's `ILIKE` is a
JavaScript regular expression, its NULL ordering is its own convention, its unique indexes do not
exist, and its `save` never raises a constraint violation. **This application has never yet run
against a real database**: there are no migrations and no e2e suite (see "Not yet decided").
Treat "774 tests pass" as evidence about the code's logic, and about nothing else.

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
- **`esModuleInterop` must stay on.** `cookie-parser` is `export =` and has no `default` export
  at runtime, so `allowSyntheticDefaultImports` alone compiles but breaks at runtime, and the
  `import x = require()` form is rejected by `@typescript-eslint/no-require-imports`.
- **Jest transforms `@scure/*` and `@noble/*`** (`transformIgnorePatterns` +
  `allowJs` in the inline ts-jest tsconfig). They are pure ESM and reached through `otplib`;
  Node loads them via `require(esm)`, jest's CommonJS runtime cannot. The pattern is
  `/node_modules/(?!.*(@scure|@noble)/)` — the `.*` matters, because these packages are also
  nested under `@otplib/*/node_modules/`.
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

Three variables govern the self-service and recovery flows, and two of them are lifetimes worth
setting on purpose:

| Variable                         | Default | Governs                                                       |
| -------------------------------- | ------- | ------------------------------------------------------------- |
| `EMAIL_CONFIRMATION_TTL_SECONDS` | 900     | how long a mailed email-confirmation code stays usable         |
| `PASSWORD_RESET_TTL_MINUTES`     | 15      | how long a mailed password-recovery code stays usable          |
| `APP_URL`                        | *empty* | the frontend origin the recovery link points at — **optional** |

`APP_URL` is the only optional one in the sense that matters: **empty is a supported value, not
a misconfiguration.** With no value the recovery message carries the code alone and says there is
no reset page for this installation. Nothing invents a host, and nothing falls back to a default
origin — a link to the wrong site is worse than no link.

## Database

PostgreSQL via TypeORM, registered with `TypeOrmModule.forRootAsync` + `ConfigService`.

`autoLoadEntities: true` is deliberate: there is **no central entity list**. Each module
registers its own entities with `TypeOrmModule.forFeature()` and they are picked up from
there — which is what keeps entity ownership (below) enforceable.

`DB_SYNCHRONIZE` is env-driven and **false by default**. It lets TypeORM rewrite the schema
to match the entities on boot; never enable it outside local development.

### Primary keys

**Identifiers are auto-increment integers** — `@PrimaryGeneratedColumn()` for the key, plain
`int` columns for references to it. This is the default for every table; `uuid` is used only
where it was **explicitly asked for**, never chosen by inference.

**`users.id` is the one uuid, and it was asked for.** `@PrimaryGeneratedColumn('uuid')` on the
entity, `@Column({ type: 'uuid' })` on every column that references it — `refresh_tokens.userId`,
`password_resets.userId`, `email_verifications.userId`, `user_backup_codes.userId`,
`invites.createdByUserId` · `usedByUserId` · `revokedByUserId`. Everything else keeps its
integer key: `invites.id` is still an `int`, and so are the ids of the four child tables.

The rest of the system follows from that column, and the places worth knowing are where a user
id crosses a boundary: the `sub` claim of every token is a **string**, `AuthenticatedUser.id` is
a string, and `PATCH /admin/users/:id` parses its parameter with **`ParseUUIDPipe`** — a
malformed id is a 400 before any service is reached. Generation is the database's job; nothing
in the application invents a uuid for a new account.

**Untested against Postgres, and there is one thing to watch.** `@PrimaryGeneratedColumn('uuid')`
needs a generator function in the database, and TypeORM issues `CREATE EXTENSION IF NOT EXISTS
"uuid-ossp"` for it — which requires a role allowed to create extensions. On a managed instance
that is not a given. Nothing here has been run against a real server (see "Not yet decided"), so
treat the first boot with `DB_SYNCHRONIZE=true`, or the first migration, as where this is
actually found out.

## HTTP layer

Set up in `main.ts`:

- **Global validation** — `ValidationPipe` with `whitelist: true`, `forbidNonWhitelisted: true`,
  `transform: true`. Unknown properties in a payload are an error, not silently dropped, and
  DTOs arrive as real class instances. Every endpoint's input therefore needs a DTO.
- **CORS** — driven by `CORS_ORIGIN` (empty = disabled, `*` = any, otherwise a comma-separated
  list) and `CORS_CREDENTIALS`. `*` together with credentials does not work — browsers reject it.
- **Cookies** — `cookie-parser` is mounted globally; without it `req.cookies` is undefined and
  the refresh flow cannot read its cookie.
- **Client IP** — Express `trust proxy` from `TRUST_PROXY` (`false` | `true` | hop count |
  e.g. `loopback`). Required for `req.ip` to hold the real client address behind a proxy;
  without it you get the proxy's address.

## API documentation (Swagger)

`@nestjs/swagger` serves the UI at **`/api`** and the OpenAPI JSON at `/api-json`.

It is **only mounted when `NODE_ENV !== 'production'`** — in production both paths return 404,
so the API surface is not published. Do not make it unconditional.

## Architecture: module boundaries

The project is built **modularly**. Feature modules sit **directly under `src/<module>/`**,
next to `src/common/` — there is no `src/modules/` level. Each module is self-contained and
owns everything it needs:

```
src/<module>/
  <module>.module.ts
  <module>.controller.ts     # HTTP layer only — see "one or many" below
  <module>.service.ts        # business logic — likewise
  dto/                       # its own validation (class-validator DTOs)
  types/                     # its own interfaces, type aliases and enums
  entities/                  # its own entities
  utils/                     # its own helpers, one function per file
  tests/                     # its own specs
```

Modules must be as **independent of each other as possible**. Design a new module so that
it can be understood, tested, and changed without opening another module's code.

### Types live in `types/`

**An interface or a custom type is declared in `types/`, in its own file — never inside a
service or a controller.** A type declared next to the class that happens to use it first is
invisible to the second consumer, and the second consumer either re-declares it or imports a
service file to get at a type. `src/users/types/user-changes.ts`,
`src/auth/types/token-payloads.ts`, `src/invites/types/invite-list-query.ts` are the shape:
the file is named after the type and holds nothing else.

**DTO classes stay in `dto/`.** They are not the exception to this rule, they are a different
thing: a DTO is a validation contract with decorators on it, checked at runtime by the global
`ValidationPipe`. A type in `types/` is erased at compile time and validates nothing. Do not
move DTOs into `types/` to "keep the types together", and do not put a bare interface in
`dto/`.

### Helpers live in `utils/`, one function per file — if they are reused

A helper is **one exported function in one file, and the file is named after the function**:
`src/admin/utils/can-issue-role.ts`, `src/auth/utils/login-of.ts`,
`src/users/utils/requested-identifier.ts`. No `utils.ts`, no `helpers.ts`, no grab-bag module
that grows a seventh unrelated export. One file per function means the import line names
exactly what is used, and a helper can be tested and moved on its own.

**A helper only becomes a file once something reuses it.** A step that one method performs once
stays inline in that method. Pulling it out buys nothing and costs a jump: the reader leaves the
method, opens another file, and finds a body that was only ever going to be called from the
place they just left. The rule exists to **remove single-use indirection, not to manufacture
files** — do not extract a helper in anticipation of a second caller, extract it when the second
caller arrives.

A helper that a **second module** needs moves to `src/common/utils/`, and again only when that
second module genuinely exists — not in anticipation of one.

The list-query helpers (`src/users/utils/user-list-where.ts`, `user-list-order.ts`, and their
`src/invites/` counterparts) each have a single call site today. They are the standing carve-out
in the tree: they carry SQL semantics — wildcard escaping, the computed invite status — that the
service should not be spelling out inline. Everything else follows the reuse test.

### One or many: splitting a service, splitting a controller

**A service that has grown large is split into logical services, each nameable in one phrase.**
If you cannot say what a service is for without listing what it does, the split is wrong or has
not happened yet. Split along **real seams** — the questions the module answers — never at a
line count, and never into `-part-1` / `-helper` shards that only make sense read together.

The directory follows the count, and only the count:

| Module has              | Layout                                          |
| ----------------------- | ----------------------------------------------- |
| one service             | `src/<module>/<module>.service.ts`               |
| more than one service   | `src/<module>/services/<name>.service.ts`        |
| one controller          | `src/<module>/<module>.controller.ts`            |
| more than one controller| `src/<module>/controllers/<name>.controller.ts`  |

`src/invites/` is still a one-service module, so `invites.service.ts` sits at the module root.
`src/users/`, `src/auth/` and `src/mail/` have `services/`; `src/auth/` and `src/admin/` have
`controllers/`. `src/users/` has a single controller and so keeps `users.controller.ts` at the
root — a module can have `services/` without having `controllers/`.

### Entity ownership (hard rule)

An entity belongs to exactly one module. **Only the owning module registers it with
`TypeOrmModule.forFeature`, and only the owning module injects its repository.** An
`@InjectRepository(Foo)` outside Foo's module, or a query against Foo's table from
anywhere else, is forbidden — business logic about an entity lives next to the entity,
never in a consumer.

When module A needs an operation on an entity owned by module B:

1. Add a service method **in module B** and put the logic there — B owns its data and the
   rules around it.
2. B exports its service; A imports B's module and calls that method.

`InvitesService` is the worked example: before issuing an invite it has to know whether the
account already exists, so it injects `UserDirectoryService` and calls `isIdentifierTaken()`. It
never reads the `users` table.

**Importing another module's entity class to declare a relation is allowed** — that is the
one exception, and it is not a loophole. A relation is schema, not behaviour: `Invite`
imports `User` for `createdBy` / `usedBy` and still has no `User` repository, so nothing
about users can be decided inside `src/invites/`.

### Relations are always declared

Every foreign key gets a real relation decorator, not merely a scalar column, so the
constraint exists in the database and TypeORM can join. The scalar column stays **alongside**
the relation, so assigning an id keeps working without loading an entity first:

```ts
@ManyToOne(() => User, { onDelete: 'RESTRICT' })
@JoinColumn({ name: 'createdByUserId' })
createdBy: User;

@Column({ type: 'int' })
createdByUserId: number;
```

`onDelete` is a decision taken per relation, never a default copied from the previous one:

| Relation                  | `onDelete` | Why                                                       |
| ------------------------- | ---------- | --------------------------------------------------------- |
| `Invite.createdBy`        | `RESTRICT` | who issued an invite is an audit trail — it must not vanish |
| `Invite.usedBy`           | `SET NULL` | the invite record outlives the account it created           |
| `Invite.revokedBy`        | `RESTRICT` | who killed a code is an audit trail too                     |
| `RefreshToken.user`       | `CASCADE`  | a session is meaningless without its user                   |
| `UserBackupCode.user`     | `CASCADE`  | likewise                                                    |
| `EmailVerification.user`  | `CASCADE`  | an outstanding code belongs to one account and dies with it |
| `PasswordReset.user`      | `CASCADE`  | likewise                                                    |

## `src/common/`

Shared solutions live in `common/`, so they are written once instead of being duplicated
per module. What belongs there:

- **Response shaping** — one uniform envelope for all responses.
- **Guards** used by more than one module — including `JwtAuthGuard`, which is registered
  globally rather than per controller.
- **Decorators** — `@Roles()`, `@WriteAccess()`, `@Public()`, `@CurrentUser()` and the Swagger
  response decorators.
- **Base classes** that modules extend — e.g. a pagination DTO, shared validation bases.
- **Helpers** — see below.

`common/` holds cross-cutting infrastructure only. Feature/business logic never goes here;
it belongs to the module that owns it.

### Helpers: `src/common/utils/`

Same rule as a module's own `utils/` (see "Helpers live in `utils/`" above), applied to the
helpers **more than one module** needs: `parse-cors-origin.ts`, `parse-trust-proxy.ts`,
`normalize-email.ts`, `normalize-telegram-username.ts`, `to-account-identifier.ts`,
`sha256-hex.ts`, `render-qr-code-data-url.ts`, `escape-like-pattern.ts`, `sort-direction.ts`.
Each is one exported function in a file named after it, and each has its own spec in
`src/common/tests/`.

`telegram-username-pattern.ts` is the one file here that exports a constant rather than a
function — the regular expression that `UpdateUserDto`, `UpdateProfileDto` and
`CreateInviteDto` all validate against. It is shared for the same reason a function would be:
three DTOs agreeing on what a Telegram username looks like must agree by construction, not by
three copies of the same literal.

This is why `main.ts` defines no parsers of its own any more: it imports `parseCorsOrigin`
and `parseTrustProxy`. Bootstrap wires things together; it does not own logic.

### Response envelope

All responses are wrapped by `ResponseEnvelopeInterceptor`
(`src/common/interceptors/response-envelope.interceptor.ts`), registered globally in `main.ts`.
Controllers return their payload plain — never wrap by hand, or you get `{ data: { data: … } }`.

There are **two shapes, and which one you get depends on what the handler returned.**

```json
{ "data": ... }                                                  // everything else
{ "data": [ ... ], "meta": { "total", "page", "limit", "pages" } }  // a paginated list
```

The split is decided by `payload instanceof Page` (`src/common/types/page.ts`). A `Page` is
unwrapped into `data` (its items) and `meta`; anything else becomes `{ data: payload ?? null }`.

**`instanceof`, deliberately — not "does it have an `items` property".** A duck-type check would
turn any ordinary payload that happens to carry `items` into a page, silently, and hand the
client a `meta` invented from fields that were never pagination. A class is a thing a handler
has to opt into by constructing one, so the shape of the response is a decision, not a
coincidence of field names.

`Page` is a real class with a `map`, which is how a controller converts entities to DTOs without
unpacking the page: `(await this.directory.list(query)).map(toUserDto)`. Services build one with
`toPage(await repo.findAndCount(...), query)` — `findAndCount` returns `[rows, total]` and
`toPage` computes `pages` from `total` and `limit`.

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

**A paginated list needs `ApiPagedResponse`, not `ApiEnvelopeResponse`**
(`src/common/decorators/api-paged-response.decorator.ts`). The two are not interchangeable and
the difference is not cosmetic: `ApiEnvelopeResponse(UserDto, { isArray: true })` documents
`{ data: UserDto[] }` and no `meta`, so a generated client for a list endpoint would have no
type for the pagination it needs to page with.

```ts
@Get()
@ApiPagedResponse(UserDto)
list(@Query() query: ListUsersQueryDto): Promise<Page<UserDto>> {}
```

The model is required — there is no such thing as an empty page — and the options are `status`
and `description`. There is no `isArray`: a paged response is always an array.

### List queries

`PaginationQueryDto` (`src/common/dto/pagination-query.dto.ts`) is the base class **every list
endpoint extends** — `GET /admin/users` and `GET /admin/invites` today, and every list endpoint
added later. This is a rule, not a description of two endpoints: a list that invents its own
parameter names is a list every client has to learn separately.

| Parameter   | Rule                                                          |
| ----------- | ------------------------------------------------------------- |
| `page`      | integer ≥ 1, default 1                                         |
| `limit`     | integer 1–100, default 20                                      |
| `search`    | optional, trimmed, ≤ 100 characters                            |
| `sortOrder` | `asc` \| `desc` (`SortOrder`), default `desc`                  |
| `sortBy`    | **declared per endpoint** — see below                          |

**`limit` over 100 is a `400`, never a silent clamp.** The `@Max(100)` rejects the request
instead of quietly capping it, and that is the point: a client that asked for 5000, got 100 rows
and a `meta.total` it did not look at would believe it had everything. A refused request is a
bug the caller can see; a clamped one is a bug that shows up as missing data somewhere else,
much later.

**`sortBy` is declared per endpoint, over an enum of that endpoint's own sortable fields.** It is
deliberately *not* on the base class: the base class cannot know what a given table may be
ordered by, and a `sortBy` typed as `string` would put a caller-supplied column name into the
query builder. `@IsEnum` over a closed set is what stops that.

```ts
export class ListUsersQueryDto extends PaginationQueryDto {
  @IsEnum(UserSortField)
  sortBy: UserSortField = UserSortField.CreatedAt;
}
```

| Endpoint             | Filters          | `sortBy`                                    |
| -------------------- | ---------------- | ------------------------------------------- |
| `GET /admin/users`   | `role`, `status` | `id` · `createdAt` · `role` · `status` · `email` |
| `GET /admin/invites` | `role`, `status` | `id` · `createdAt` · `expiresAt` · `role`   |

The DTOs live in `src/admin/dto/` because the endpoints are the admin module's, but the
**services take an interface, not the DTO** — `UserDirectoryService.list(query: UserListQuery)`,
`InvitesService.list(query: InviteListQuery)`, both declared in the owning module's `types/`.
The DTO satisfies the interface structurally, so `src/users/` never imports anything from
`src/admin/` and a second caller of `list()` does not have to build an admin DTO to call it.

`search` matches `email` or `telegramUsername` on users, and `code`, `email` or
`telegramUsername` on invites. Every sort except `id` breaks its tie on `id`
(`{ createdAt: direction, id: direction }`), so paging is stable — without a tiebreak, two rows
with the same `createdAt` can swap between page 1 and page 2 and a row is seen twice or not at
all.

#### Two traps, invisible once you get them wrong

**Invite `status` is computed, so filtering by it is translated to SQL.** There is no `status`
column: `inviteStatus()` derives `pending | used | revoked | expired` from `usedAt`, `revokedAt`
and `expiresAt`, **in that order of precedence** — a code that was used is `used` whatever else
is set, a revoked one is `revoked` even after its expiry passes. The
filter therefore goes through `inviteStatusConditions()` (`src/invites/types/invite-status.ts`),
which turns the requested status into real conditions — `{ usedAt: IsNull(), revokedAt: IsNull(),
expiresAt: MoreThan(now) }` for `pending`, and so on. Note that `revokedAt: IsNull()` belongs in
**both** `pending` and `expired`: leave it out of `expired` and a revoked invite shows up under
two statuses at once. **Do not filter after fetching.** A `.filter()` over
the fetched page returns rows that look entirely plausible next to a `meta.total` counted before
the filter ran, and a `pages` computed from it — the page is short, the total is wrong, and
nothing errors.

**`search` is escaped.** `%` and `_` are `ILIKE` wildcards, so a search for `a_b` would otherwise
match `axb`, and a search for `%` would match every row. `escapeLikePattern()`
(`src/common/utils/escape-like-pattern.ts`) backslash-escapes `\`, `%` and `_` before the term
goes into `ILike(\`%${...}%\`)`. Any new searchable field goes through it too.

## Authentication

Registration is **invite-only** and two-factor authentication is **mandatory** — an account
cannot exist without a confirmed TOTP secret. A person is invited by an email **or** a Telegram
username, and their role comes from the invite they redeemed. Neither is frozen afterwards: an
admin can add the second identifier, change the role, and reset the second factor.

### Modules

| Module         | Owns                                                     | Exposes                                              |
| -------------- | -------------------------------------------------------- | ---------------------------------------------------- |
| `src/users/`   | `users`, `user_backup_codes`, `email_verifications`       | four services (below), `/users/me*`                  |
| `src/invites/` | `invites`                                                 | `InvitesService` (no controller)                     |
| `src/auth/`    | `refresh_tokens`, `password_resets`                       | `/auth/*`, `SessionService`                          |
| `src/admin/`   | nothing                                                   | `/admin/*` — `admin`/`superadmin` HTTP only          |
| `src/mail/`    | nothing                                                   | `AccountMailService` — every message the system sends |

The admin surface is a **separate module with its own controllers** (`AdminInvitesController`,
`AdminUsersController`). It owns no entities and never touches another module's repository: it
calls `InvitesService`, the users services and `SessionService` — `AdminModule` imports
`AuthModule`, `InvitesModule` and `UsersModule` and nothing else. Keep it that way — every
future admin endpoint goes into `src/admin/` and delegates to the module that owns the data.

#### `src/users/` — four exported services, and no facade

`src/users/` has **six services and no `UsersService`**. A consumer injects the one that owns
the behaviour it needs:

| Service                     | Answers                                                            | Exported |
| --------------------------- | ------------------------------------------------------------------ | -------- |
| `UserDirectoryService`      | finding users — by id, by identifier, by login; listing; uniqueness  | yes      |
| `UserCredentialsService`    | passwords, TOTP verification, backup codes                          | yes      |
| `UserEnrolmentService`      | registration, 2FA confirmation, 2FA reset and re-setup              | yes      |
| `UserAdministrationService` | the fields an admin may change on an account                        | yes      |
| `UserProfileService`        | what the owner may change about themselves                          | no       |
| `EmailVerificationService`  | the outstanding email code — issuing it, checking it                | no       |

The last two are used only by `UsersController`, so `UsersModule` does not export them: a
service is exported when another module needs it, not because it exists.

**The facade was removed deliberately.** `UsersService` had become 75 lines of pure delegation,
and it hid which consumer needed which part — every caller depended on the whole of "users"
whether it read one field or rewrote an account. A module-wide entry point also makes a bad
split invisible: with everything reachable through one class, nothing ever forces the question
of what the module is actually made of. Injecting `UserDirectoryService` says what the consumer
uses; injecting `UsersService` said nothing. Do not reintroduce an aggregate service, and do not
add a method to one of these six that belongs to another.

#### `src/auth/` — three controllers, three services

Paired by concern, one controller per service:

| Controller             | Service            | Concern                                                    |
| ---------------------- | ------------------ | ---------------------------------------------------------- |
| `EnrolmentController`  | `EnrolmentService` | `/auth/register`, `/auth/register/confirm`, `/auth/2fa/*`   |
| `SessionController`    | `SessionService`   | `/auth/login`, `/auth/refresh`, `/auth/logout`              |
| `PasswordController`   | `PasswordService`  | `/auth/password/change`, `/password/forgot`, `/password/reset` |

Only `SessionService` is exported — `AdminModule` needs it to revoke sessions after an
admin-set password, and `PasswordService` needs it to issue one.

#### `src/mail/` — it owns every message the system sends

`AccountMailService` is the module's **only export**, and every outgoing message is written
there: the invite code, the email-confirmation code, the password-recovery code. A module that
needs to send something calls a named method (`sendInviteCode`, `sendEmailConfirmationCode`,
`sendPasswordRecoveryCode`) and passes it the facts — an address, a code, an expiry. It does not
compose a subject or a body.

`MailTransportService` is the nodemailer transport, and it is **hidden behind
`AccountMailService`**: it is a provider of `MailModule` but not an export, so no other module
can reach `send({ to, subject, text })` and no other module can invent its own wording. Where
the wording lives is not a detail — mail is the one part of the system a user reads, and wording
scattered across four modules drifts into four different voices and four different mistakes.

**The recovery link is built in `AccountMailService`, and that is where it belongs.** A link is
message content, not password logic: `PasswordService` produces the code and knows nothing about
a frontend. `APP_URL` is read in the mail service, and when it is empty **no link is invented** —
the message carries the code and says there is no reset page for this installation.

**SMTP is optional.** An empty `MAIL_HOST` means no transport is built at all: the app boots,
`send()` logs a warning and returns `false` instead of throwing, and invites are still created —
the admin just passes the code on by other means, since it is in the `POST`/`GET /admin/invites`
response either way. Setting `MAIL_HOST` makes `MAIL_FROM` required, so a half-configured
transport cannot reach production.

Nothing in the API tells the caller whether a message actually went out — `send()` returns a
boolean, but no endpoint surfaces it, and every caller swallows a send failure into the log
rather than failing the operation. That is the right default for an invite (the code is in the
response) and a **real gap** for the email confirmation and the password recovery, where the
code exists nowhere else.

### Roles

`Role` (`src/common/enums/role.enum.ts`) is a hardcoded enum — there is no role table and no
role management endpoint:

`trader` · `lead_trader` · `merchant` · `merchant_support` · `merchant_agent` · `cascade` ·
`admin` · `superadmin`

It lives in `common/` because the user entity, the invite entity and `RolesGuard` all need it.

**A role is never chosen by the person registering.** It is fixed on the invite when the admin
issues it and copied onto the user at registration, so `User.role` has **no default** — an
account cannot come into existence without an invite that names its role. There is no `user`
role and no "default" role; if you are looking for one, the model has changed under you.

#### Who may issue which role

`canIssueRole(issuer, target)` (`src/admin/utils/can-issue-role.ts`) is the whole policy:

- `superadmin` — may issue any role.
- `admin` — may issue anything **except** `admin` and `superadmin`. Otherwise any admin could
  mint peers and superiors and the distinction between the two levels would be decoration.
- anyone else — nothing.

The same function also gates **who may edit whom**, **which role an edit may grant** (see
`PATCH /admin/users/:id` below) and **whose invite may be revoked** (see
`POST /admin/invites/:id/revoke`). That reuse is deliberate: "may act on" is one question, so
there is one answer to it, and the four uses cannot drift apart in a later edit.

Admin endpoints are guarded by `@UseGuards(RolesGuard, WriteAccessGuard)` +
`@Roles(Role.Admin, Role.Superadmin)`. `JwtAuthGuard` is **not** in that list and must not be
added: it is global (see "Authorisation is re-checked on every request") and runs before any
controller-scoped guard, which is what puts `request.user` there for the other two to read.
`RolesGuard` without `@Roles` lets everything through, so the decorator is always required
alongside the guard.

### Identity: an email, a Telegram username, or both

**Two different invariants live here, and conflating them is the mistake to avoid.**

**An invite carries exactly one identifier** — an email or a Telegram username, never both and
never neither. `InvitesService.create` normalises the input and answers **400** unless exactly
one of the two arrived, and redemption is bound to that single identifier.

**A user may hold both.** The invite decides which one the account starts with; `PATCH
/admin/users/:id` can then add the other, and from that moment **either one logs the person in**
— `findAuthenticatableByLogin` looks up whichever field the login string parses into. Where a
single string is needed — `UserDto.login`, the `login` claim in a token, the otpauth label — the
**email wins and the Telegram username is the fallback** (`user.email ?? user.telegramUsername`).

An identifier can be **added but never removed**. An absent field means "leave this one alone";
an empty string is a **400**, refused twice over — by `UpdateUserDto` (`@IsEmail()` and the
Telegram pattern both reject `''`) and again by `requestedIdentifier`
(`src/users/utils/requested-identifier.ts`), which will not let a normalised identifier come out
empty. That helper is shared by the admin path and the self-service path, so both refuse a
clearing attempt the same way. There is no way through the API to take an email or a username
off an account once it is set; if that is ever needed it has to be built.

`users.email` and `users.telegramUsername` are **both nullable and both uniquely
indexed**. That combination works because Postgres allows any number of NULLs in a unique
index, so every Telegram-only account leaves `email` NULL without colliding with the others.

`AccountIdentifier` (`src/common/types/account-identifier.ts`) is the shape that carries an
identity around — `{ email?, telegramUsername? }` — and `toAccountIdentifier()` decides which
kind a login string is: an `@` **after the first character** means email, anything else is a
Telegram username. `a@b.com` is an email; `@durov` and `durov` are both the same Telegram
username, because everything is normalised before use (trimmed, lower-cased, and the Telegram
`@` prefix stripped) so `Durov` and `@durov` cannot become two accounts.

Uniqueness is enforced in **two** places when an invite is issued:

1. against existing users that are past registration (`isIdentifierTaken`, which ignores
   `pending_two_factor` rows so an abandoned registration does not lock the identifier out);
2. against **live** invites — a second usable code for the same person is a **409**, because
   it would be a second way into one account.

The second check is application logic, not a constraint: `invites.email` and
`invites.telegramUsername` are indexed but **not** unique, since a used or expired invite must
be allowed to sit next to a fresh one. The database will not catch two admins issuing at the
same instant.

Redemption is bound to the same identifier: an email invite is not redeemable with a Telegram
login and vice versa (**403**). The comparison is over the whole `AccountIdentifier`, both
fields at once — matching one field while the other differs is not a match. This stays a
single-identifier comparison even now that users can hold two, because the login string a
registration arrives with only ever parses into one of the fields.

**Telegram invites have no delivery channel in this system.** `InvitesService` logs the code
with a warning and the admin passes it on by hand; there is no bot and no outgoing Telegram
message. Email invites are mailed, but a mail failure is caught and logged — **it never fails
invite creation**, because the code is already stored and visible in `POST`/`GET /admin/invites`.

**Adding an identifier through `PATCH /admin/users/:id` is guarded by the same uniqueness rule**:
`assertHeldByNobodyElse` answers **409** if another registered user already holds the value,
ignores `pending_two_factor` rows for the reason `isIdentifierTaken` does, and stays quiet when
the value is already the edited user's own. It does **not** consult live invites, so an admin can
give a user an identifier that an unredeemed invite was issued for — and that invite then dies on
redemption, because `startRegistration` finds an account past registration under it and answers
409.

### Registration flow

1. An admin issues an invite — `POST /admin/invites { role, email | telegramUsername, expiresAt? }`.
   The role is checked against `canIssueRole` (403), the code is generated and stored, and an
   email invite is **emailed**. `GET /admin/invites` is a **paginated** list (see "List queries")
   of every code with its computed status (`pending | used | revoked | expired`), filterable by
   `role` and `status` and searchable over the code, the email and the Telegram username. Each
   row also carries **who issued it, who redeemed it and who revoked it** — `createdBy`, `usedBy`
   and `revokedBy`, as `InviteAccountDto` (`id`, `login`, `role`); `usedBy` is `null` until the
   invite is burned and `revokedBy` until it is killed. All three come from
   `relations: { createdBy: true, usedBy: true, revokedBy: true }` on the query, and `POST`
   re-reads the invite with `createdBy` loaded so the created and the listed shapes match.

   **`expiresAt` is optional and has no ceiling.** Absent, the code lives `INVITE_TTL_HOURS` from
   now; given, it must be a date **strictly in the future** (`@Type(() => Date)` + `@IsDate()` +
   `@MinDate(() => new Date())` — a past moment is a 400) and may be as far away as the admin
   likes. There is deliberately no maximum: an over-long code is a decision an admin can make and
   then take back, because revocation exists.
2. `POST /auth/register { login, password, inviteCode }` — `login` is the email or Telegram
   username, and it must match the one the invite was issued for (403 otherwise). Creates a
   user with status `pending_two_factor` **and the role carried by the invite**, and returns
   `otpauthUrl` + `secret` + `qrCode` for the authenticator app, plus a short-lived
   `registrationToken` that carries the login and the invite through step 3.
3. `POST /auth/register/confirm { registrationToken, totp }` — the first correct one-time code
   activates the account, burns the invite and returns the session together with **10 backup
   codes, shown once**.

Between step 2 and step 3 the account cannot log in. Repeating step 2 for an unfinished
registration is allowed and replaces the password, the role and the secret; an identifier that
is already **past** registration is a 409. The invite is consumed only in step 3, so a wrong
one-time code does not burn it.

#### The three enrolment artefacts

`qrCode` is the `otpauthUrl` rendered as a PNG data URI (`data:image/png;base64,…`), ready to
drop into an `<img src>`. It is an **addition, never a replacement**: all three are returned
together and all three stay. A camera can fail, a screenshot can be unreadable, and very often
the authenticator app is on the same device as the open page — there is nothing to scan there,
and typing the `secret` is the only way through. Do not slim the response down by dropping
`secret` or `otpauthUrl`.

The rendering happens in `EnrolmentService` (`src/auth/`), from the `otpauthUrl` that
`UserEnrolmentService` returned — `renderQrCodeDataUrl` (`src/common/utils/`).
`UserEnrolmentService` renders nothing: it owns the secret and the entity, not presentation.

### Killing an invite before it is used

`POST /admin/invites/:id/revoke` → **200**, the updated `InviteDto`. It writes `revokedAt` and
`revokedByUserId` and nothing else; the row **stays**, and `GET /admin/invites` keeps listing it
with status `revoked` and the account that killed it. That is the whole reason it is not a
`DELETE`: an invite that vanishes leaves no answer to "who issued this code and what happened to
it", and `createdBy` is already `RESTRICT` for the same reason. `revokedBy` is `RESTRICT` too.

Two guardrails, and they sit in different places on purpose:

- **`canIssueRole(admin.role, invite.role)` — 403**, checked in `AdminInvitesController`. An
  `admin` cannot revoke an `admin` or `superadmin` invite, for the same reason it cannot issue
  one. This is the controller's business because it is a question about the caller.
- **the status — 409**, checked in `InvitesService.revoke`. A **used** invite cannot be revoked
  (the account already exists; killing the code changes nothing and the record is history), and
  a revoked one cannot be revoked twice. An **expired** invite *can* be revoked: it is already
  unusable, but marking it takes it out of the `expired` filter and says a human decided it was
  dead rather than the clock. An unknown id is a 404.

Revocation is felt in two places without either being written for it: `assertUsable` refuses
anything whose `inviteStatus()` is not `pending`, so a revoked code stops being redeemable at
once, and `findLiveInvite` looks for a `pending` invite, so **revoking frees the identifier** and
a fresh code can be issued for the same person immediately.

### Login

One request: `POST /auth/login { login, password, totp | backupCode }`. `login` is any identifier
the account holds — one that holds both signs in under either. A backup code is accepted instead
of the one-time code and is single-use. All failures answer with the same message — never tell
the caller which factor was wrong, or whether the account exists.

### Changing and recovering a password

Three endpoints, all on `PasswordController`, all in **`src/auth/`** — not in `src/users/`, even
though a password is a user's field. They belong here because each one **issues or destroys
sessions**, and sessions are what this module owns. `PasswordService` writes the password through
`UserAdministrationService.update`, so the hashing rule stays in one place, and calls
`SessionService` for the rest.

#### `POST /auth/password/change { currentPassword, newPassword }` → 200

Authenticated (the global `JwtAuthGuard`, plus `WriteAccessGuard` and `@WriteAccess()`). The
current password is re-checked — a stolen access token is not enough — and a wrong one is a 401.

**It revokes every session and returns a fresh one**, with a new refresh cookie. The caller keeps
working; every other device is signed out **at once**, access tokens included: their `sid` names
a `refresh_tokens` row that is now revoked, so the next request they make is a 401 rather than a
wait for the TTL. Note what it does not do: spare "the current session".
It cannot. The refresh cookie is scoped to `path=/auth`, so a request arriving at any other route
never carries it, and the handler has no way to identify which stored token belongs to the
caller. Issuing a new session is not a workaround for that — it is the only correct answer to it,
and it happens to be the behaviour you want anyway.

#### `POST /auth/password/forgot { login }` → **always 202**

Identical status and identical body — `{ "data": null }` — whether the login belongs to nobody,
belongs to an account with no email, belongs to an account whose email is **unverified**, or
actually results in a message. This is the point of the endpoint, not a rough edge: anything that
distinguishes the cases turns it into an oracle for which logins exist and which are recoverable.

**Recovery requires a *verified* address** (`if (!user?.email || !user.emailVerified) return;`).
An unverified address is one nobody has proved control of — which, after a typo, is somebody
else's address. Sending recovery mail there would hand account recovery to whoever owns the
mistyped domain, and that is exactly what the flag exists to prevent. It also means a user who
never confirmed their email has **no self-service way back in**; an admin has to set a password.

The lookup is `findAuthenticatableByLogin`, so `blocked` and `pending_two_factor` accounts get
the same silence.

#### `POST /auth/password/reset { login, code, newPassword }` → 200 `{ "data": { "message": "success" } }`

Sets the password and **revokes every session** — a recovery that left the attacker's sessions
alive would recover nothing. Every failure is the same `400`, "Password reset is invalid, used or
expired": unknown login, no reset on record, already used, expired, out of attempts, wrong code.

The body is `MessageDto` (`src/auth/dto/message.dto.ts`), the same shape `forgot` answers with,
so the two halves of recovery read alike to a client. It was a `204` with no body; a caller
cannot tell an empty success from an empty anything, and a documented body is worth the extra
bytes.

**There is one secret and it is the emailed code.** The link in the message carries the same
code as a query parameter (`{APP_URL}/reset-password?login=…&code=…`) — there is **no separate
link token**, and a link is not a second factor. Anyone reading the message can use either; the
link only saves typing. `APP_URL` is optional: with no value no link is built at all and the
message says so, rather than pointing at an invented host.

The record is a `password_resets` row (`src/auth/entities/password-reset.entity.ts`) holding the
hash of the code, a failed-attempt counter, an expiry (`PASSWORD_RESET_TTL_MINUTES`) and
`usedAt`. **Five wrong attempts spend it**: the counter is checked before the code is compared,
so the sixth attempt is refused even if it is right. Unlike the email-confirmation row this one
is not deleted — it is marked `usedAt` on success and simply stays dead — and `forgot` deletes
only *unused* rows before issuing a new one, which keeps the spent ones as a trail.

`resetPassword` reads the **newest** row for the user (`order: { id: 'DESC' }`), so asking for a
second code invalidates the first in practice: the older row is no longer the one consulted.

### Tokens

- **Access token** — JWT in the response body, sent back as `Authorization: Bearer`. Its
  payload is `{ sub, sid, login, role, type }` — `login`, not `email`, because the login may be a
  Telegram username. It carries no status, and its `role` is **not** what authorises a request
  (see below).

  **`sid` is the id of the `refresh_tokens` row this session was opened with**, and it is what
  makes a logout mean something. Without it an access token outlives its own session: nothing on
  the server knows the pair it came from, so a signed token keeps working until its TTL runs out
  even after the refresh token was revoked. `JwtAuthGuard` reads the row and refuses a token
  whose session is revoked or expired, so `POST /auth/logout` closes both halves at once. This
  is why `issueSession` **stores the refresh token first and signs the access token second** —
  the row has to exist before its id can go into a claim. Do not reorder that.
- **Refresh token** — JWT delivered **only as an httpOnly cookie** (`refresh_token`, path
  `/auth`), never in the body. `POST /auth/refresh` rotates it: the old token is revoked and a
  new pair is issued — and since the new pair carries a new `sid`, the previous access token
  dies with the previous session. `POST /auth/logout` revokes it and clears the cookie.

  The cookie policy is **hardcoded, not configuration**: `httpOnly`, `secure`, `sameSite=strict`,
  `path=/auth`, host-only. `refreshCookieOptions()` takes nothing but an optional lifetime, so
  there is no env variable and no code path that produces a weaker cookie — do not add one. A
  frontend on a different site would need `sameSite=none`; that is a decision to raise, not a
  switch to introduce.
- **Registration token** — `{ sub, login, inviteCode, type }`, carrying `POST /auth/register`
  through to `POST /auth/register/confirm`.
- **Two-factor setup token** — `{ sub, login, type }`, the same short journey for a
  **re-enrolment**: `POST /auth/2fa/setup` to `POST /auth/2fa/confirm` (see below).

There are **four token kinds but only three secrets** — access, refresh, registration, each at
least 32 characters. The setup token is signed with the **registration** secret and the
registration TTL, so a signature check alone cannot tell a registration token from a setup token.
What separates them is the `type` claim (`TokenType`, `src/common/types/token.ts`: `access` ·
`refresh` · `registration` · `two_factor_setup`), verified after the signature: a token of the
wrong type is rejected even when the signature checks out. That check is not decoration — drop it
and a registration token would confirm a re-enrolment, and vice versa. Adding a fourth secret is
an option, not a requirement; the `type` claim is what is relied on today.

### User statuses

`UserStatus` (`src/users/types/user-status.enum.ts`):

| Status               | Can authenticate | Can write | Meaning                                     |
| -------------------- | ---------------- | --------- | ------------------------------------------- |
| `pending_two_factor` | no               | —         | 2FA not confirmed: registering, or just reset |
| `active`             | yes              | yes       | the normal state                            |
| `suspended`          | yes              | **no**    | may sign in and read; a marked write is 403 |
| `blocked`            | **no**           | no        | shut out entirely                           |

`suspended` is the point of having four states rather than a boolean: it keeps a person able to
see their own data while stopping them changing anything. `pending_two_factor` is **not something
an admin assigns** — `UserAdministrationService.update` answers 400 for
`status: pending_two_factor`. An
account is in it for exactly two reasons: registration has started and is unfinished, or its
second factor was reset (`resetTwoFactor`, below).

### Authorisation is re-checked on every request

`JwtAuthGuard` is registered **globally**, through `APP_GUARD` in `AppModule` — it is not listed
in any controller's `@UseGuards`. That is deliberate and it has a price worth stating plainly:
**every route is protected by default, and a route that must not be needs `@Public()`**
(`src/common/decorators/public.decorator.ts`). `SessionController` and `EnrolmentController`
carry it on the class; `PasswordController` carries it on `forgotPassword` and `resetPassword`
only, because `changePassword` is authenticated. A forgotten decorator does not open a hole —
it shuts a door, and login is the first thing to break. Specs pin which handlers are public for
exactly that reason.

The guard is global because it needs both `UserDirectoryService` (`src/users/`) and
`SessionService` (`src/auth/`), and `AuthModule` already imports `UsersModule`. Instantiating it
per controller would force `UsersModule` to import `AuthModule` back, which is a cycle; resolved
once in the root module, it is not.

`JwtAuthGuard` does not trust the token beyond its signature. After verifying it, the guard
**checks the session named by `sid` is still live** (`SessionService.isSessionLive` — the
`refresh_tokens` row must exist, be unrevoked and unexpired) and then **loads the user from the
database** (`findAuthenticatableById`, which returns only `active` or `suspended` rows), taking
`role` and `status` from that row. A revoked session is a 401. A missing row — deleted,
`blocked` or back in `pending_two_factor` after a second-factor reset — is a 401. A token with
no numeric `sid` is a 401 before either query runs, so a token minted before `sid` existed is
simply refused rather than waved through.

The cost is **two SELECTs per protected request**, and it is accepted deliberately: blocking
someone, changing their role, or signing a device out must take effect at once, not whenever
their access token happens to expire. Do not "optimise" this away by reading the role out of the
JWT or by trusting the signature alone; either reintroduces a window in which a blocked account,
or a logged-out device, keeps working.

Writes are refused for `suspended` users by `WriteAccessGuard`, which acts only on handlers
marked `@WriteAccess()`. This is an **explicit decorator, not an inference from the HTTP verb**
— Nest gives the guard no reliable notion of "this handler mutates", and guessing from `POST`
would both miss mutating `GET`s and block harmless ones. The consequence is the thing to
remember: **an unmarked mutating handler is a hole**. Every endpoint that changes state gets
`@WriteAccess()`, and the controller lists `WriteAccessGuard` in `@UseGuards` — it reads
`request.user`, and the global `JwtAuthGuard`, which runs first, is what puts it there.

### The user's own profile

`src/users/` exposes three endpoints, all on `UsersController`, all guarded by
`@UseGuards(WriteAccessGuard)` on top of the global `JwtAuthGuard`, and **no `@Roles`** — every
role manages their own account.

| Endpoint                        | `@WriteAccess()` | Does                                             |
| ------------------------------- | ---------------- | ------------------------------------------------ |
| `GET /users/me`                 | no               | the signed-in user's own row                      |
| `PATCH /users/me`               | **yes**          | adds a missing identifier                         |
| `POST /users/me/email/confirm`  | **yes**          | proves the address a mailed code was issued for   |

`GET /users/me` returns `id`, `login`, `email`, `emailVerified`, `telegramUsername`, `role`,
`status`, `createdAt` (`ProfileDto`, `src/users/dto/profile.dto.ts`). It carries **no
`@WriteAccess()`** — it is a read, so a `suspended` user keeps it, which is the point of
`suspended` being a state distinct from `blocked`. A `blocked` user never reaches the handler at
all: `findAuthenticatableById` returns only `active` and `suspended` rows. The other two are
marked, so a `suspended` user reads their profile and cannot change it.

Nothing in the response comes from the token. The guard has already replaced the claims with a
fresh row, and the handler reads that row again for the fields `AuthenticatedUser` does not carry
(`email`, `telegramUsername`, `createdAt`), so the profile cannot report a role an admin changed
a second ago. That is two SELECTs per call, and a row that disappears between them is a 401.

`ProfileDto` is **its own type, not the admin module's `UserDto`**. What the owner sees and what
an admin sees are two contracts; do not share one DTO between them. They no longer match anyway:
`ProfileDto` carries `emailVerified` and `UserDto` does not.

#### `PATCH /users/me` — adding an identifier yourself

`{ email?, telegramUsername? }`, both optional, an **empty body is a 400** ("No changes were
given"), and the response is the updated `ProfileDto`. What a user may do here is **add the
identifier they do not have**, not swap the one they do:

| Field              | Account has none                                                | Account already has one                                    |
| ------------------ | --------------------------------------------------------------- | ---------------------------------------------------------- |
| `telegramUsername` | written at once                                                  | **409** — only an admin can change it                       |
| `email`            | written at once as **unverified**, and a 6-digit code is mailed  | replaceable while unverified; **409** once verified         |

Both go through `UserProfileService.editOwnIdentifiers`, and both are checked against
`assertHeldByNobodyElse` first, so adding an identifier somebody else already holds is a **409**
before anything is written.

**An email is written immediately, with `emailVerified: false`.** The address is not held in a
token or a pending row waiting to be proved — it goes onto the account, and the flag says whether
anyone has proved control of it. This is worth understanding because it is the opposite of the
usual "confirm before writing": the user sees the address they typed on their own profile
straight away, `login` starts resolving to it, and everything that *matters* — password recovery
— gates on the flag rather than on the presence of the field.

**An unverified address may be replaced.** Issuing a new code deletes any outstanding one
(`issueFor` does a `delete({ userId })` first), so a user who mistyped an address simply patches
the right one and the old code stops working. A **verified** address is frozen and only an admin
can change it: it is the address recovery mail goes to, and letting a session that might not be
the owner's redirect it would make an account takeover permanent.

#### `POST /users/me/email/confirm` — spending the code

`{ code }`, six digits, and it answers with the updated `ProfileDto`. The pending state is an
`EmailVerification` row (`src/users/entities/email-verification.entity.ts`) holding the user, the
address the code was issued for, the **hash** of the code, a failed-attempt counter and an
expiry (`EMAIL_CONFIRMATION_TTL_SECONDS`). The plaintext code exists only in the email.

- The comparison is `timingSafeEqual` over the hashes, and every rejection — no row, expired,
  wrong code, or a row whose `email` no longer matches the account's — is the **same 401**,
  "Confirmation code is invalid or expired".
- **Five wrong attempts delete the row.** After that the endpoint answers exactly as it does for
  an unknown code, so a caller cannot tell "you have used up this code" from "there was never a
  code" — and the user's route back is the same either way: patch the address again.
- The row is deleted on success too, and `issueFor` deletes any existing row before writing a
  new one, so a user has **at most one outstanding code**.

**Six digits is a million guesses and nothing here rate-limits anything.** The five-attempt
counter is per *row*, and a user can mint a fresh row whenever they like by re-patching the
address — so the ceiling on guesses is five per code, not five per address. It is not a
brute-force defence; a rate limiter is (see "Not yet decided").

One consequence of the admin path not touching the row: if an admin sets a different address
while a code is outstanding, the row still names the old address, and `confirm` refuses it
because `pending.email` no longer equals `user.email`. Safe, but silent — the user gets an
invalid-code answer for a code that was valid when it was sent.

#### Where `emailVerified: true` comes from

Only two things set it, and the difference between them is the whole idea:

| Origin                                    | Starts | Why                                                                      |
| ----------------------------------------- | ------ | ------------------------------------------------------------------------ |
| registration from an **email invite**     | `true` | the code was mailed to that address and redeemed from it — control proven |
| registration from a **Telegram invite**   | `false` | there is no email; nothing was proved                                    |
| an admin setting `email`                  | `false` | an admin typed an address; nobody proved anything                        |
| `POST /users/me/email/confirm`            | `true` | the user returned the code that was mailed there                          |

`UserEnrolmentService.startRegistration` writes `emailVerified: Boolean(identifier.email)` — an
email registration is verified **at creation**, with no confirmation step, and that is not a
shortcut. The invite code was delivered to that address and came back; requiring a second code
sent to the same address would prove the same fact twice. A Telegram registration leaves `email`
NULL and the flag `false`, which is simply the truth: the account has no email to verify.

### Admin surface for users

- `GET /admin/users` — a **paginated** list (`{ data, meta }`, see "List queries"), each row
  carrying `id`, `login` (the email if there is one, otherwise the Telegram username), `email`,
  `telegramUsername`, `role`, `status` and `createdAt`. Filters: `role`, `status`, `search`
  (over email and Telegram username). `UserDto` does **not** carry `emailVerified` — the flag is
  in `ProfileDto` only, so an admin cannot currently see whether an address was ever confirmed.
  That is worth fixing before anyone relies on the list to audit recovery-capable accounts.
- `PATCH /admin/users/:id` — **one endpoint for every field**:
  `{ email?, telegramUsername?, role?, password?, status?, resetTwoFactor? }`. Every field is
  optional, an **empty body is a 400** ("No changes were given"), and the response is the updated
  `UserDto`. There is no separate status endpoint — do not look for one.

Three guardrails, all in `AdminUsersController`:

- `canIssueRole(admin.role, target.role)` — an `admin` may not edit an `admin` or a `superadmin`
  (403);
- **and**, whenever the body carries `role`, `canIssueRole(admin.role, dto.role)` (403). Both
  checks are needed and they ask different questions: the first is *who the target is*, the
  second is *what they would become*. Without the second an `admin` could edit a `trader` into a
  `superadmin` and mint exactly the superior the invite rules exist to prevent.
- **nobody may edit their own account** (403) — an admin cannot suspend, unblock, promote or
  reset themselves.

The target is loaded with `findById`, **not** `findAuthenticatableById`. This is not an
oversight: the restricted finder hides `blocked` and `pending_two_factor` rows, so using it would
make unblocking someone — or re-resetting a second factor — impossible.

#### What an edit costs elsewhere

| Change                             | Side effect                                                                       |
| ---------------------------------- | --------------------------------------------------------------------------------- |
| `password`                         | **every refresh token of that user is revoked** (`SessionService.revokeAllSessions`) |
| `email`                            | **`emailVerified` drops back to `false`** — see below                              |
| `telegramUsername` · `role` · `status` | none                                                                            |
| `resetTwoFactor`                   | the account stops being authenticatable — see the next section                      |

A password its owner did not choose must not leave the owner's sessions alive, which is why that
one field reaches into `src/auth/` at all. `role` and `status` need nothing: `JwtAuthGuard`
re-reads both from the database on every request, so a demotion or a suspension is already in
force on the next call and there is no stale token to chase.

**An admin-set email is unverified, always.** `UserAdministrationService.update` writes
`emailVerified: false` alongside any `email` it sets, and unlike `PATCH /users/me` it will
overwrite a **verified** address as well — that is the whole point of it being the admin path.
Nobody proved control of an address an admin typed in, so it does not carry the flag that
password recovery depends on, and the user has to confirm it themselves before recovery works
again. Note what this does *not* do: it does not mail a confirmation code. Only
`PATCH /users/me` issues one. An admin who sets an address leaves the user with an unverified
email and no outstanding code, and the user has to re-enter the same address on `/users/me` to
get one.

**The order is deliberate and observable.** `UserAdministrationService.update` runs first, then the side
effects, and `resetTwoFactor` is applied last — so `{ status: 'active', resetTwoFactor: true }`
in one request leaves the account `pending_two_factor`: **the reset wins over a status in the
same body**, and the returned DTO shows the state after it. `resetTwoFactor: false` is not an
empty body, but it changes nothing.

### Resetting a second factor

Losing the phone **and** the backup codes is recoverable:
`PATCH /admin/users/:id { "resetTwoFactor": true }`. `UserEnrolmentService.resetTwoFactor` does three
things, and the third is the one worth understanding:

1. status back to `pending_two_factor`, `twoFactorConfirmedAt` back to `null`;
2. **every backup code deleted**;
3. **`totpSecret` replaced with a fresh value nobody will ever use.**

That third value is never handed out and is overwritten again the moment the user starts
re-enrolling, so its only job is to **kill the authenticator app the user already has, at the
instant of the reset**. Leaving the old secret in place would work just as well for re-enrolment
— and would leave a stolen phone generating valid codes until the user got round to it.

**The admin never sees a secret.** The response is the plain `UserDto`: no `secret`, no
`otpauthUrl`, nothing to pass on and nothing to leak. The user re-enrols themselves, with the
password they already have:

```
POST /auth/2fa/setup    { login, password }   -> { setupToken, expiresIn, otpauthUrl, secret, qrCode }
POST /auth/2fa/confirm  { setupToken, totp }  -> { accessToken, expiresIn, backupCodes } + refresh cookie
```

It is the second half of registration reached without an invite: `2fa/confirm` goes through the
same `confirmTwoFactor`, so it activates the account and returns **ten fresh backup codes, shown
once**, together with a session and the refresh cookie. `2fa/setup` hands back the same three
enrolment artefacts as registration step 2 — `secret` included, for the same reasons. Each call
writes a **new** secret, so a user who scanned the first QR code and then called it again must
scan the second — only the last one works.

`POST /auth/2fa/setup` requires the account to be in `pending_two_factor`, and **answers
identically to an unknown login, a wrong password and a wrong status**: the same 401, "Invalid
login or password". The uniformity is the whole point. It is an unauthenticated endpoint, and a
distinguishable "wrong status" would tell an attacker precisely whose second factor is currently
reset — which is exactly the account worth attacking while that window is open. Do not make this
message more helpful.

Two things look like missing steps and are not:

- **Nothing revokes the sessions of a reset account, and nothing needs to.**
  `pending_two_factor` is not authenticatable, so `JwtAuthGuard` finds no row and 401s on the
  next request, and `POST /auth/refresh` cannot trade the cookie in either. The sessions stop
  working at the moment of the reset, without a single token being touched.
- **The password is untouched.** Re-enrolment is authenticated by it; a reset that also cleared
  the password would leave nobody able to prove they own the account.

### What is stored, and how

| Value                     | Storage                                                            |
| ------------------------- | ------------------------------------------------------------------ |
| Password                  | bcrypt, 12 rounds                                                   |
| TOTP secret               | plaintext — TOTP verification needs the secret itself               |
| Backup codes              | SHA-256 of the code; `usedAt` burns it                              |
| Refresh tokens            | SHA-256 of the JWT, with `expiresAt` / `revokedAt`                  |
| Email confirmation codes  | SHA-256, with `failedAttempts` / `expiresAt`; the row is **deleted** |
| Password recovery codes   | SHA-256, with `failedAttempts` / `expiresAt`; marked `usedAt`        |
| Invite codes              | **plaintext** — the admin list has to show the codes                |

SHA-256 (not bcrypt) is deliberate for backup and refresh tokens: they are high-entropy random
values, so a slow hash buys nothing and a login would have to bcrypt-compare ten codes.

The two six-digit codes are hashed for a **different** reason, and it is worth being honest
about it: six digits is a million possibilities, so a hash of one falls to a wordlist in
milliseconds. Hashing them does not make them hard to reverse — it means a database leak, or a
log line, or a backup, does not hand over a *live* code, and it keeps the plaintext to exactly
one place: the message that was sent. What actually limits guessing is the five-attempt counter
and the TTL, and those live in the row, not in the hash. The email-confirmation comparison uses
`timingSafeEqual`; the password-reset one is a plain `!==` on the hex strings — an inconsistency,
though not an exploitable one, since a timing side channel on a hash comparison leaks nothing
about a value the attacker would still have to guess in full.

Invite codes are stored in the clear **because the admin must be able to read the list**. They
are short-lived, single-use and bound to one identifier and one role — but treat the `invites`
table as secret material: a leaked code is a free account at whatever role it names.

## Not yet decided — ask, do not assume

- Exact filenames/layout inside a module beyond the roles listed above (`dto/` vs `validation/`,
  singular vs plural directory names).
- The final response envelope (see above) and whether errors share it.
- Migrations: whether schema changes go through TypeORM migrations (and where they live) or
  stay on `DB_SYNCHRONIZE` locally. Only the `synchronize` flag exists today — the six tables
  (`users`, `user_backup_codes`, `email_verifications`, `invites`, `refresh_tokens`,
  `password_resets`) have **no migration**, so a real environment has no way to create them yet,
  and the application has never been run against a real database.
- Whether `src/common/{config,interceptors,decorators,guards,enums,types,utils}/` are the right
  homes for what is in them — they were placed there as cross-cutting infrastructure; confirm
  or move.
- How the **first `superadmin`** is created in a fresh database. Today: by hand, with a row
  written directly into `users` — every other account needs an invite, and every invite needs
  an issuer, so the chain has to start somewhere outside the API. Whether that becomes a seed
  command, a bootstrap env variable or stays manual is undecided.
- Whether an identifier can be **cleared**. It cannot, on either path: an empty string is a 400
  (`IDENTIFIER_CANNOT_BE_CLEARED`) and an absent field means "leave alone". Whether removing one
  should be possible at all (and what it would mean for an account left with neither) is open.
- **What a user may change about themselves without an admin.** Self-service now exists — a user
  can *add* a missing email or Telegram username (`PATCH /users/me`), confirm that email, and
  change their own password. What is still admin-only is **changing or clearing an identifier the
  account already holds**: a verified email and any Telegram username are frozen to the owner.
  Whether a user should be able to move a verified address themselves — and what proof that
  should take — is undecided. Do not open it up by loosening the 409s.
- Nothing surfaces whether a message was actually **delivered**.
  `MailTransportService.send()` returns a boolean and failures are logged, but no endpoint or
  field reports it. For invites that is tolerable — the code is in the API response — but for the
  **email-confirmation and password-recovery codes it is a real gap**: the code exists only in
  the message, so a user who never receives one sees an endpoint that succeeded and a code that
  never arrives. Telegram invites are never delivered by the system at all — that part is
  intentional; the missing visibility is not.
- **Rate limiting / lockout. There is none anywhere.** It is missing on login, registration and
  invite redemption, and the flows added since make it matter more, not less:
  `POST /auth/password/forgot` (an unthrottled mail trigger, and an enumeration probe if it ever
  stops answering uniformly), `POST /auth/password/reset` and `POST /users/me/email/confirm`
  (six-digit codes, five attempts per record, and nothing stopping a caller from minting records
  in a loop), and `POST /auth/2fa/setup`. The per-record attempt counters are not a substitute;
  they bound one code, not the caller.
- Password policy beyond 8–128 characters.
- Whether an admin should be able to see `emailVerified`. `UserDto` does not carry it, so
  `GET /admin/users` cannot tell an admin which accounts can recover a password.
