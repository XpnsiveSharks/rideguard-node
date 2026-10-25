# SOS provider simulation

Created 2026-10-25 from TextBee's public API reference and delivery-status docs.

## Purpose
Run the real TextBee HTTP adapter against a local stateful fixture. The member
never sends SMS. No connected vendor workspace was available for owner discovery.

## Execution
1. `postman simulation run postman/simulations/sos-provider.sim.yaml --port 4968 --output ndjson`
2. In another shell: `$env:TEXTBEE_SIM_BASE_URL='http://127.0.0.1:4968/textbee'` then
   `node node_modules/jest/bin/jest.js --runInBand --testPathPatterns=textbee.http`.
3. Inspect request events and `/textbee/__test/counts`. Stop with Ctrl+C.

## Assumptions
2026-10-25: The opt-in test accepts only loopback `/textbee` URLs. Reset before each
run. This fixture models single-recipient batches, not carrier timing or quotas.
The provider's default device is deliberately not resolved or guessed.

## Observations
<!-- begin:observations -->
2026-10-25: `textbee.http.spec.ts` passed. The sole member served one send and eleven
status checks, including sent/completed ambiguity, saved-device lookup, uncertain
delivery_failed, auth/404/429/HTML 503/malformed/timeout. No member stayed silent.
<!-- end:observations -->

## What didn't work
2026-10-25: Real aborted fetch initially mapped to network_error under Jest's Error
realm. Checking the request's aborted signal fixed timeout classification; rerun passed.
