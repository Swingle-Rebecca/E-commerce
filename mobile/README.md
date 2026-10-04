# Becca Shop mobile

Native React Native + Expo Android app for the existing shop. It uses the website's Express API, Google identities, Postgres products, and per-user Postgres cart. No WebView and no local-only cart.

## Before signing in

1. Run npm install at the repository root.
2. Run npm run db:migrate with the shop's DATABASE_URL configured locally. Alternatively paste migrations/002-mobile-cart.sql into the Supabase SQL editor. It is safe to run again.
3. Deploy the backend and web changes in this branch to Netlify.
4. In Netlify environment variables, BASE_URL must be https://beccasho.netlify.app (no trailing slash). Keep DATABASE_URL, SESSION_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and Mailgun configuration on the server.
5. In Google Cloud Console → APIs & Services → Credentials → your Web application OAuth client, set the authorized redirect URI to exactly https://beccasho.netlify.app/auth/google/callback. A redirect to the homepage will not complete login.
6. If the OAuth consent screen is in Testing, add the account used in the video as a test user.

The mobile app signs in using the system browser. Google returns to the HTTPS backend callback; the backend redirects a short-lived one-use code to beccashop://auth. The app exchanges it with its PKCE verifier, and stores the resulting session in Expo SecureStore. The mobile session points to the same user row as the web session. No additional Google Android client or Google secret in the APK is required for this flow.

## Install dependencies and check the JavaScript build

From mobile:

    npm ci
    npx expo install --check
    npx expo export --platform android

To change the website, copy .env.example to .env and edit EXPO_PUBLIC_API_URL before building. This URL is public configuration, not a secret.

## Download an APK from GitHub Actions

The Build Android APK workflow builds on pushes to mobile-shared-cart or main. In the repository, open Actions → Build Android APK → a successful run → Artifacts → becca-shop-apk. Download the ZIP, extract app-release.apk, and install it on Android, allowing installation from your browser/files app if prompted.

This standalone APK bundles the JavaScript and does not need Expo Go, a Metro server, or an Expo account. Expo prebuild's default debug signing key is used for this classroom preview APK; use a private release key before any store release. APK artifacts expire after 30 days and downloading them requires GitHub sign-in. Upload the extracted APK to Drive with “Anyone with the link” access for the instructor.

Workflow builds are not proof that Google sign-in and your live database work. Complete the phone test below before submitting.

## Other build options

With Android Studio and Java 17 installed:

    npm ci
    npx expo prebuild --platform android
    cd android
    ./gradlew assembleRelease

On Windows use gradlew.bat assembleRelease instead. The APK is at android/app/build/outputs/apk/release/app-release.apk.

Or use Expo EAS:

    npx eas-cli login
    npx eas-cli build:configure
    npx eas-cli build --platform android --profile preview

EAS configuration may require choosing your Expo account and linking a project. The included preview profile produces an APK.

Google sign-in needs this app's custom URL scheme. Use an installed APK or a development build, not Expo Go.

## Continuous video checklist

Record one uninterrupted video with the browser and Android device/emulator visible together.

1. Open https://beccasho.netlify.app and sign in with a Google account new to this shop.
2. Show the website account is signed in.
3. Add product A to the website basket; show its name and quantity.
4. Open the installed Becca Shop app.
5. Tap Continue with Google, select the same Google account, and show the email in the app header.
6. Open Basket; show product A from the website.
7. Add a different product B from the app.
8. Return to the website. It refreshes the basket every four seconds while visible and on focus. Show products A and B.
9. Optionally change a quantity to demonstrate that both screens update.

Keep a stable connection. “Basket synced at…” only updates after a successful server fetch or cart change. A request failure is displayed; it is not silently treated as a saved basket.

## Submission links

- APK: upload the extracted APK to an accessible file-sharing service.
- Source: use this repository's mobile folder (or the repository URL with this branch selected).
- Video: share the continuous recording with download/view access.
- Team contribution PR: submit a real contribution PR in your team's repository. A PR in your personal shop repository counts only if that is also the team's repository.

## Validation

Root npm test covers authentication and web ↔ mobile cart routes. The route test uses Express, Passport web sessions, bearer sessions, and PGlite (in-process PostgreSQL). It validates schema/migration replay, cart sharing, another account's isolation, invalid input, token expiry, and token revocation. It does not exercise Google's live consent screen, the Android browser deep link, Netlify sessions, concurrent production Postgres connections, or email delivery.
