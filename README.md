# navaratne-family-books

Pastel family book catalogue with a keypad lock screen, Firebase Realtime Database, search, bookcase views, reader tracking, and editable book records.

## Run Locally

1. Copy `.env.example` to `.env`.
2. Adjust `APP_PASSCODE` if you want a different code.
3. Run `python3 server.py`.
4. Open `http://127.0.0.1:8000`.

## GitHub Pages

This repo now includes a GitHub Pages workflow in [.github/workflows/pages.yml](.github/workflows/pages.yml). It builds a static site and generates `config.js` from repository variables or secrets, so Pages can host it without the Python server.

Set these repository variables or secrets in GitHub:

1. `APP_PASSCODE`
2. `FIREBASE_API_KEY`
3. `FIREBASE_AUTH_DOMAIN`
4. `FIREBASE_DATABASE_URL`
5. `FIREBASE_PROJECT_ID`
6. `FIREBASE_STORAGE_BUCKET`
7. `FIREBASE_MESSAGING_SENDER_ID`
8. `FIREBASE_APP_ID`

Then enable GitHub Pages with source set to GitHub Actions.

## Firebase / Local Config

This app uses Firebase Realtime Database with the config injected by `server.py` from environment variables. The database paths used are `books` and `bookcases`.
