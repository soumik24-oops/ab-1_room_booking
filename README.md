# AB-1 Room Booking — 6-room prototype

A browser prototype for booking six AB-1 rooms:

- Classrooms: 108, 308
- Discussion rooms: 211, 311
- Conference rooms: 216, 316

## Authorization prototype

The portal now checks an **authorized-user list** containing email, roll number, department, role, and status. Only active users whose department is Physics or Mathematics are allowed through the portal.

The sample authorization list is `authorized-users.csv`. In the intended production setup, this list should be maintained in a **private, department-controlled repository** and synchronized to the booking server. The browser should not directly access a private GitHub repository or hold a GitHub token.

### Important security note

This prototype checks membership in the authorization list, but it does **not yet prove that the person controls the email account**. For production, replace the current email-only gate with either:

1. IISER SSO/CAS, or
2. a server-side email OTP/magic-link flow.

The authorization database/repository can remain the source of truth for Physics/Mathematics eligibility.

## Run

Open `index.html` in a browser. For a local web server, use:

```bash
python3 -m http.server 8000
```

then open `http://localhost:8000`.

## Production architecture

```text
Department offices
       |
       | maintain
       v
Private authorization repository
       |
       | server-side sync/API
       v
Booking server <---- IISER SSO or email verification
       |
       v
AB-1 booking database
       |
       +-- 108 / 308 classrooms
       +-- 211 / 311 discussion rooms
       +-- 216 / 316 conference rooms
```
