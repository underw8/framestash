# Releasing

## Release flow

1. Bump `version` in `extension/manifest.json` and commit.
2. Tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z`.
3. `release.yml` fails unless the tag (without `v`) equals the manifest version. It then runs `scripts/check-manifest.js` and `scripts/package.sh` (test suites, `node --check`, zip) and creates a GitHub Release for the tag with `framestash-X.Y.Z.zip` attached.

`ci.yml` runs the same checks on every push and pull request and keeps the zip as a run artifact (`framestash-zip`).

## Store publishing (publish.yml)

`publish.yml` downloads a release's zip, uploads it to the Chrome Web Store API v2 and submits it for review. Its automatic trigger (`workflow_run` after a successful Release run) is commented out until the setup below is done; until then it runs only when started by hand (Actions → Publish to Chrome Web Store → Run workflow, with a tag).

### One-time setup

1. **First submission by hand.** In the [developer dashboard](https://chrome.google.com/webstore/devconsole), upload the zip from a GitHub Release and fill in the listing from [store-listing.md](store-listing.md). The API can only update an item that already exists.
2. **IDs.** The publisher ID is shown in the dashboard's account settings; the extension ID is the item's 32-letter ID.
3. **Google Cloud project.** Create one (or reuse one) and enable the **Chrome Web Store API**.
4. **OAuth client.** Configure the OAuth consent screen (External; add yourself as a test user), then create an OAuth client ID of type **Desktop app**. Note the client ID and secret.
5. **Refresh token.** Open this URL in a browser signed in as the publisher account, approve, and copy the `code` from the address it redirects to:

   ```
   https://accounts.google.com/o/oauth2/auth?response_type=code&scope=https://www.googleapis.com/auth/chromewebstore&client_id=CLIENT_ID&redirect_uri=http://localhost&access_type=offline&prompt=consent
   ```

   Exchange it for a refresh token:

   ```bash
   curl -sS -X POST https://oauth2.googleapis.com/token \
     -d client_id=CLIENT_ID -d client_secret=CLIENT_SECRET -d code=CODE \
     -d grant_type=authorization_code -d redirect_uri=http://localhost
   ```

   The reply's `refresh_token` is the one to keep. A consent screen left in Testing issues refresh tokens that expire after 7 days; publish the consent screen to keep it valid.
6. **Repository secrets** (Settings → Secrets and variables → Actions): `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`, `CWS_PUBLISHER_ID`, `CWS_EXTENSION_ID`.

### Enabling it

1. Check the credentials without uploading anything. The store rejects an upload whose version isn't higher than the published one, so a test run on an existing release would fail. This asks for the item's status instead:

   ```bash
   tok=$(curl -sS -X POST https://oauth2.googleapis.com/token \
     -d client_id=CLIENT_ID -d client_secret=CLIENT_SECRET \
     -d refresh_token=REFRESH_TOKEN -d grant_type=refresh_token | jq -r .access_token)
   curl -sS -H "Authorization: Bearer $tok" \
     https://chromewebstore.googleapis.com/v2/publishers/PUBLISHER_ID/items/EXTENSION_ID:fetchStatus
   ```

   A JSON reply with the item's status means the token and IDs are right.
2. Uncomment the `workflow_run:` block in `.github/workflows/publish.yml`. Each successful Release run then submits its zip to the store; the next release is the first real test.
