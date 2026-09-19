# End-to-end tests

These run a real browser against a running app, because what they check is what
a browser actually receives: response headers, whether a disabled download is
reachable over the network, and whether the first page of a document is visible
before anything else loads.

```bash
pnpm test:e2e                       # starts the dev server if nothing is listening
E2E_BASE_URL=https://… pnpm test:e2e  # against a deployed environment
```

`public-surface.spec.ts` needs only the web app. `share-journey.spec.ts` needs
Redis, the worker, LibreOffice and Poppler, so it skips unless
`E2E_FULL_JOURNEY=1` is set — a skipped test is honest, a mocked one is not.

Three viewports run by default: desktop, tablet and phone. Traces, screenshots
and video are kept on failure only.
