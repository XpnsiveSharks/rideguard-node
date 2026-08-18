# Code Organization

Two questions come up constantly while building this backend:

1. Which folder does this belong in?
2. Should this live in its own file, or stay where it is?

This page records the reasoning we actually used, so the answers stay consistent
instead of being re-argued in every PR.

## Which Folder

| Folder | Holds | Test |
| --- | --- | --- |
| `src/config/` | The app's own configuration contract | Describes how this app is configured. No I/O, no external SDK. |
| `src/infra/` | Adapters wrapping an external system | Talks to something outside the process (Firebase, pino, a queue, a DB driver). |
| `src/modules/` | Feature code | Owns a route, a use case, or business logic. |
| `src/types/` | Ambient type declarations | Extends a third-party type globally (for example the Express `Request`). |

The single question that separates the first two: **does it talk to something
outside the process?** If yes it is infrastructure, if no it is configuration.

This is why env validation lives in `src/config/` and not `src/infra/`.
`firebase.provider.ts` and `logger.config.ts` are adapters over an SDK, but the
Joi schema has no external dependency and no lifecycle. It is also something
those adapters *consume* — putting it beside them as a sibling would imply a
peer relationship it does not have.

## When To Split A File

The default is **keep it where it is**. Splitting is not free:

- Every split adds a hop for whoever is reading the code.
- Things that change together but live apart drift apart.
- A file boundary implies the two halves are independent. If they are not, the
  boundary is lying to the next reader.

Split when at least one of these is true:

| Trigger | Meaning |
| --- | --- |
| Different change cadence | The two parts get edited at different times, for different reasons. |
| Runtime import cost | A consumer needs a **value** from the file and would drag a heavy dependency in with it. |
| Crossing a boundary | Several modules need one half and have no business knowing about the other. |
| Too big to hold | You can no longer see the whole contract on one screen, or the file has collected unrelated exports. |

Keep it together when:

- The two parts must change in lockstep, and especially when the compiler
  already enforces that.
- There is only one consumer.
- The file is small enough to read in one pass.

## Type Imports Are Free

The "runtime import cost" trigger fires less often than it seems, because
`import type` is erased at compile time. Importing a type never pulls the
source file into the bundle.

Check it yourself rather than guessing:

```bash
yarn build
grep -n "require(" dist/infra/firebase/firebase.provider.js
```

`firebase.provider.ts` imports `EnvironmentVariables` from `src/config/`, but
the compiled output only requires `@nestjs/config`, `firebase-admin`, and
`./firebase.constants`. The config file is absent, so Joi is never loaded by
the infra layer. If the file you are worried about does not appear in the
`require` list, the import costs nothing and is not a reason to split.

This is only true for `import type`. A plain `import` of a **value** does emit
a require.

## Worked Example: env.validation.ts

`src/config/env.validation.ts` exports four things: `NODE_ENVIRONMENTS`,
`NodeEnvironment`, `EnvironmentVariables`, and `envValidationSchema`. They stay
in one file, checked against all four triggers:

- **Change cadence** - identical. Adding a variable touches the interface and
  the schema in the same edit.
- **Runtime cost** - zero, verified above.
- **Boundary** - only `main.ts` and the two infra files consume the type, all
  as `import type`.
- **Size** - under 30 lines.

The lockstep argument is the strongest one. The schema is declared as:

```ts
export const envValidationSchema = Joi.object<EnvironmentVariables, true>({
```

The `true` is Joi's `isStrict` flag, which forces the schema map to cover every
key of `EnvironmentVariables`. Adding a variable to the interface alone fails
the build:

```
error TS2345: Property 'REDIS_URL' is missing in type '{ NODE_ENV: ... }'
  but required in type 'StrictSchemaMap<EnvironmentVariables>'.
```

That guarantee reads correctly because both halves are visible at once. Split
across two files, the error points at a file that looks complete on its own.

### The trigger that would change the answer

`NODE_ENVIRONMENTS` is a runtime value, not a type. Today it is only read
inside its own file. The moment a module imports it **as a value** - a guard
doing `NODE_ENVIRONMENTS.includes(x)`, say - that module starts requiring Joi
at runtime. At that point, move `NODE_ENVIRONMENTS` and `NodeEnvironment` into
`src/config/env.constants.ts` and leave `EnvironmentVariables` beside the
schema, since it is the half that is genuinely coupled to it.

A second schema landing in `src/config/` is the other trigger. Once types are
shared by more than one schema, they have earned their own file.

## Before You Split

- [ ] Name the trigger. If you cannot point at one, do not split.
- [ ] Check whether the parts change in lockstep. If they do, splitting adds a
      drift risk you did not have before.
- [ ] For the runtime-cost argument, confirm it against `dist/` instead of
      assuming.
- [ ] Ask whether the compiler still enforces the same guarantees afterward.
