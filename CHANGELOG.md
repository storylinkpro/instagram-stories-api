# Changelog

## 0.1.2

- The client sends the access token in the `Authorization` header, not in the URL. Proxy and server logs no longer record it. The client also removes the token from the `paging.next` URLs that Meta returns.
- The timeout now works on Node 20.0 to 20.2 when you pass your own `signal`.
- The publish workflow runs the dev dependencies in a job that cannot get an npm token.

## 0.1.1

- The package description, keywords and README make the package easier to find.
- A GitHub Actions workflow publishes new versions with npm provenance.

## 0.1.0

- First release. A typed client and CLI that read an Instagram account, its Stories, posts and reels, and their insights.
