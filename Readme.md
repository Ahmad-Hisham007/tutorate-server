# 📚 Tutorate‑Server

An Express‑based REST API that powers the Tutorate platform – a marketplace where **students post tuition requirements** and **tutors apply**.  
Features include user management, posting & applying for tuitions, payments via Stripe, and role‑based access control with Firebase authentication.

---

## ⚙️ Tech Stack

- **Node.js & Express 5**
- **MongoDB** (official driver)
- **Firebase Admin SDK** for token verification
- **Stripe** (payment intents)
- **dotenv** for environment configuration
- Utilities: `cors`, `nodemon` (dev), `install` (dependency helper)

---

## 🚀 Getting Started

### 1. Clone & install

```bash
git clone <repo-url>
cd tutorate-server
npm install
```

### 2. Environment variables

Create a `.env` file in the project root:

```
PORT=3000
MONGO_URI=mongodb+srv://...
STRIPE_SECRET_KEY=sk_test_...
FIREBASE_PROJECT_ID=...
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
```

> **Note:** wrap `FIREBASE_PRIVATE_KEY` in quotes and replace literal `\n` with newlines as shown; the code handles this.

### 3. Index creation (optional)

```bash
node createIndexes.js
```

Indexes are also created automatically on server start.

### 4. Run the server

```bash
npm start           # uses node index.js
# or for development with reloads:
npx nodemon index.js
```

By default the app listens on `http://localhost:3000` or the port defined in `PORT`.

---

## 🗂 Project Structure

```
tutorate-server/
├── index.js           # main Express app (all routes & middleware)
├── createIndexes.js   # standalone script to build Mongo indexes
├── package.json
├── Readme.md          # ← you’re reading it
└── vercel.json        # deployment config
```

---

## 🔐 Authentication & Authorization

- Firebase ID tokens are verified via `verifyToken` middleware.
- Users are stored in MongoDB with roles: `student`, `tutor`, `admin`.
- Role guards (`verifyRole`) restrict access to certain endpoints (e.g., only students can post tuitions).

---

## 📦 API Endpoints Overview

All routes are prefixed with `/api`.

### Public

- `GET /tutors` – list all active tutors
- `GET /tutors/:id` – tutor details
- `GET /tuitions` – search/filter tuition posts
- `GET /tuitions/:id` – view a tuition

### Authenticated

- **Users**
  - `POST /users` – register
  - `POST /users/google` – Google login
  - `GET/PUT /users/profile` – view/update profile
  - `GET /users/stats` – role‑based statistics
  - `GET /users/activity` – recent posts/applications
  - `DELETE /users/profile` – soft‑delete account

- **Students** (requires role = student)
  - CRUD for `/tuitions` (own posts)
  - `/student/tuitions/:id/applications` – view applicants
  - `/applications/:id/:action` – approve/reject (triggers payment flow)
  - `/create-payment-intent` – Stripe intent
  - `/payment/success` – mark payment completed
  - `/payments/history` – payment history
  - `/students/my-tuitions` – paginated posts

- **Tutors** (requires role = tutor)
  - `POST /applications` – apply to a tuition
  - `/applications/my-applications` – list own applications
  - PUT/DELETE `/applications/:id` – modify pending application
  - `GET /tutor/tuitions/ongoing` – current assignments
  - `GET /payments/revenue-history` – earnings report

- **Admin** (role = admin)
  - `/admin/users` – manage users (list, update role/status, delete)
  - `/admin/tuitions` – browse/approve/reject
  - `/admin/reports` – aggregated stats & charts

---

## 🧠 Middleware & Helpers

- `ensureDBConnection` reconnects if Mongo is lost.
- Firebase initialization handles escaped private key newlines.
- CORS and JSON parsers applied globally.

---

## 📄 Scripts

| Script                 | Description                  |
| ---------------------- | ---------------------------- |
| `npm start`            | Run production server        |
| `npm test`             | placeholder (not configured) |
| `npm run vercel-build` | Vercel build hook (echo)     |

---

## 📁 Deployment

A `vercel.json` exists for deploying to Vercel. The API works as a serverless function or full Node process depending on the platform.

---

## 🛠️ Development Tips

- Use `nodemon` for hot reload.
- Keep the `.env` file secure – especially Firebase and Stripe keys.
- MongoDB collections: `users`, `tuitions`, `applications`, `payments`.

---

## 📝 Contributing

Feel free to open issues or PRs.  
Ensure new endpoints follow existing patterns: verify token, role checks, and consistent response format:

```json
{ "success": true|false, "data": ..., "error": "message" }
```

---

## 📜 License

ISC (as per `package.json`).

---

> Built with 💡 in Express & MongoDB – happy tutoring!
