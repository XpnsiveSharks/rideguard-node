# Contributing to RideGuard Backend

This guide covers how to get the project running, how the code is organized, and
how to scaffold new feature modules with `gen:module`.

## Requirements

- Node.js 20+

## Getting started

```bash
yarn install
yarn dev           # watch mode on http://localhost:3000
```

Every feature lives under `src/modules/<feature>/`. Keep controllers thin —
routing, validation, and shaping the response — and put the actual logic in the
service.

## Generating a new module

Don't hand-create the three files. Use the generator:

```bash
yarn gen:module rides
```

That runs the Nest CLI three times behind the scenes and produces:

```
CREATE src/modules/rides/rides.module.ts
CREATE src/modules/rides/rides.controller.ts
CREATE src/modules/rides/rides.service.ts
UPDATE src/app.module.ts
```

The `UPDATE` line matters: the Nest CLI **automatically imports the new module
into `app.module.ts`** for you, so there's no manual wiring step. The generated
module already declares its own controller and provider:

```ts
@Module({
  controllers: [RidesController],
  providers: [RidesService],
})
export class RidesModule {}
```

### Naming

Use kebab-case for multi-word features:

```bash
yarn gen:module ride-history     # → src/modules/ride-history/ride-history.module.ts
```

The name is used verbatim for the folder and filenames, so `ride_history`
would give you `ride_history.module.ts`. Class names are always PascalCase
regardless (`RideHistoryModule`). Stick to kebab-case so the tree stays
consistent.

## Branching and commits

- Branch off `development`, not `main`.
- Name branches `feat/<short-description>` or `fix/<short-description>`.
- Write [Conventional Commits](https://www.conventionalcommits.org/):
  `feat: add ride cancellation endpoint`, `fix: handle expired tokens`,
  `chore: bump nest to 11.1`.

## Before opening a PR

- [ ] `yarn lint` passes
- [ ] `yarn test` passes
- [ ] No stray `console.log` or commented-out code
- [ ] PR targets `development` and describes what changed and how to test it

## Suggested VScode extensions

- Prettier - Code formatter (prettier.io)
