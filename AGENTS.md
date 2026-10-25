# Backend instructions for AI agents

1. Read [the deployment checklist](docs/deployment-checklist.md) before changing backend code or tests.
2. When changing a shared guard or service, search for its callers and test mocks. Update affected mocks and keep authentication and ownership checks intact.
3. Use typed mocks where possible. Do not use broad type casts to hide missing methods or weaken tests to make CI pass.
4. Before handing off code, run the checklist's tests and production build. Report the actual results and any checks you could not run. Documentation-only changes need link and diff checks.
5. Do not bypass failed checks, skip failing tests, or change deployment gates to ship a fix.
