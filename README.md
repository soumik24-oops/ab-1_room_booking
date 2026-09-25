# AB-1 Room Booking System — v2 architecture

Six AB-1 rooms:
- Classrooms: 108, 308
- Discussion rooms: 211, 311
- Conference rooms: 216, 316

## Authorization architecture

The booking server reads two **private GitHub repositories**:
- `ab1-authorized-mathematics`
- `ab1-authorized-physics`

Each repository contains four files:
- `Faculties.csv`
- `PhD.csv`
- `BS-MS.csv`
- `Postdocs.csv`

Only an active `@iiserb.ac.in` email found in one of those files is authorized.

### Important GitHub permission model

GitHub does not provide different collaborator permissions for different folders inside one repository. Therefore, if Mathematics and Physics offices need different write access, they must be **two separate private repositories**. They can live under one GitHub Organization, for example `ab1-authorized-users`.

## Current prototype

This version provides the backend authorization lookup and retains the six-room browser prototype. It is **not yet production authentication**: the backend currently creates a development session after the authorization-list lookup.

For production, replace that development step with IISER-approved SSO/CAS/Google Workspace authentication. The server must verify the authenticated identity before issuing a session.

## Setup

1. Create the two private authorization repositories.
2. Put the four CSV files in each repository.
3. Create a GitHub token/app credential with read-only Contents access to those two repositories.
4. Copy `.env.example` to `.env` and fill in the values.
5. Install dependencies:
   `npm install`
6. Start:
   `npm start`
7. Open:
   `http://localhost:3000`

Never put `GITHUB_TOKEN` in `index.html`, `app.js`, or any client-side code.
