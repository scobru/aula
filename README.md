# Aula

Open source, self-hosted alternative to Google Classroom. One Node script, one SQLite file, one folder of uploads. No npm dependencies (Node >= 22.5). UI in English and Italian.

**Classes**: join codes for students and a separate code for co-teachers; leave / remove members; archive (read-only) and delete.
**Stream**: announcements, assignments (due date, points, attachments), quizzes, materials; topics with filter; edit posts; schedule a post for later.
**Work**: students write answers, attach files, turn in / unsubmit. Quizzes are multiple choice and auto-graded (one attempt; the answer key shows after submitting).
**Grading**: draft grades stay hidden until the teacher returns them; gradebook (students x assignments) with CSV export.
**Talk**: class comments on every post, private comments between a student and the teachers.
**Organise**: to-do (late / to do / done), "to return" list for teachers, calendar of due dates, in-app notifications.
**Account**: sign in with username + password (no email), profile, password change (other sessions are signed out), logout, 30-day sessions.

```bash
npm start        # http://127.0.0.1:8788
npm test
```

| Env var | Default | |
|---|---|---|
| `PORT` / `HOST` | `8788` / `127.0.0.1` | listen address |
| `AULA_DATA` | `./data` | `aula.db` + `files/`: back it up |
| `AULA_REGISTRATION` | `open` | `closed` once your users exist |
| `AULA_MAX_UPLOAD` | 25 MB | per file, bytes |

## Deploy

```bash
docker compose up -d --build     # http://127.0.0.1:8788, data in the `aula-data` volume
```

Put HTTPS in front before exposing it, e.g. Caddy: `aula.example.org { reverse_proxy 127.0.0.1:8788 }`. Back up the `/data` volume (`aula.db` + `files/`). Set `AULA_REGISTRATION=closed` once everyone has an account.

Without Docker: `PORT=8788 AULA_DATA=/var/lib/aula node --no-warnings server.js`. API is plain JSON with `Authorization: Bearer <token>`; see `server.js`.

## Known limits

- 0.1 databases are not migrated (0.1 was never released): delete `data/`. 0.2 databases migrate automatically (old emails keep working as usernames).
- No password reset: usernames are the only identity, so a forgotten password cannot be recovered yet (planned: reset by the class owner).
- The Dockerfile has not been built in CI.
- No email, per-user upload quota, rubrics, or import/export of a whole class.
- A scheduled post does not notify anyone when it goes live.
- Quiz questions are single-answer multiple choice, one point each; quizzes cannot be edited after posting.
- Login throttle is in memory (resets on restart).
