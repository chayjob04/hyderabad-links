# @hl/api-client

Placeholder. This package will contain the TypeScript client **generated from the
backend's OpenAPI document**. Never edit generated files by hand: change the API
and regenerate.

## The document now exists

It did not when this placeholder was written, which is why the package is empty.
The API describes itself through `Microsoft.AspNetCore.OpenApi`, and serves the
document at:

```
GET /openapi/v1.json
```

With `OpenApi:Enabled` absent it is on in Development and off everywhere else.
Setting it overrides that either way, so it is served outside Development only
when something asks for it — so a generator running in CI or against staging
can read it, while production does not publish a map of the `/admin` and
`/super-admin` routes by default. `ApiDescription.cs` in the API explains the
reasoning; `OpenApiDocumentTests.cs` asserts that the document is produced, that
every audience appears in it, and that the switch works.

To look at it locally:

```powershell
npm run dev:api
curl http://localhost:5080/openapi/v1.json
```

Operations are tagged by audience — `Public`, `Sign in`, `Customer`,
`Business owner`, `Admin`, `Super admin`, `Webhooks` — derived from the path, so
a client can be generated per audience rather than as one flat surface. That
matters here because the audiences do not share a token: a client holding an
owner's token has no business exposing the admin calls.

## Still to do

The generator itself and the CI "client is up to date" check. Neither is wired
up, so nothing is generated yet and nothing imports this package. Picking a
generator is a dependency decision, which CLAUDE.md says to ask about before
taking.
