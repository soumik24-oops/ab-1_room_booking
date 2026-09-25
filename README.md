# AB-1 Room Booking — Email OTP version

This version keeps the existing GitHub authorization architecture and adds email ownership verification.

## Render environment variables

Existing:
- GITHUB_OWNER=soumik24-oops
- GITHUB_TOKEN=<secret>
- MATH_REPO=ab1-authorized-mathematics
- PHYSICS_REPO=ab1-authorized-Physics
- PORT=3000

New:
- RESEND_API_KEY=<secret>
- RESEND_FROM_EMAIL=<sender on a Resend-verified domain>

For temporary Resend testing, the default sender is `onboarding@resend.dev`, but Resend restricts that test sender to the email address associated with the Resend account. For real IISER users, verify a domain in Resend and set `RESEND_FROM_EMAIL` to an address on that verified domain.

## OTP behavior

- 6-digit server-generated code
- 10-minute expiry
- one-time use
- maximum 5 verification attempts
- 60-second resend cooldown
- maximum 5 code requests per IP/email per 15 minutes
- OTP stored only as a hash
- authenticated session stored in an HttpOnly cookie

The current room-booking data model remains the browser localStorage prototype; this OTP change does not convert bookings into a shared database.


## Personal-email testing

For development testing, set:

- `TEST_MODE=true`

In TEST_MODE, the authorization CSV may contain your personal email address and the application allows a normal email address instead of requiring `@iiserb.ac.in`. The OTP is sent directly to the email address entered on the login screen.

For this test, the entered email must also be present with `status=active` in one of the private Mathematics/Physics CSV files.

**Do not use TEST_MODE in production.** Set `TEST_MODE=false` before real deployment; production then requires `@iiserb.ac.in`.

The default sender remains `onboarding@resend.dev` for Resend testing. Resend restricts that test sender to the email address associated with your Resend account, so use your Resend account email for this test.
