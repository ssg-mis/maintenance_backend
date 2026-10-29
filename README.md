# Maintenance Management Backend

Backend for the supplied `New_Demo_Maintenance` frontend.

## Stack

- Node.js
- Express
- PostgreSQL
- JWT authentication
- bcrypt password hashing
- Helmet / CORS / Morgan

## Important compatibility note

The supplied frontend currently stores its application data in Zustand/local mock data and does **not** make HTTP API requests. This backend therefore does not modify the frontend. It exposes REST APIs matching the frontend's actual entities and data shapes so the frontend can be integrated later without redesigning the database/backend.

No frontend source file is included or changed in this backend package.

## Setup

### 1. PostgreSQL

Create a database:

```sql
CREATE DATABASE maintenance_management;
```

### 2. Configure environment

Copy `.env.example` to `.env` and update the PostgreSQL credentials.

### 3. Install

```bash
npm install
```

### 4. Create tables

```bash
npm run db:init
```

### 5. Seed project data

```bash
npm run db:seed
```

Seeded logins:

- `admin / admin123`
- `user / user123`

Change these passwords before production use.

### 6. Start

Development:

```bash
npm run dev
```

Production:

```bash
npm start
```

Server defaults to `http://localhost:5000`.

## API

All protected endpoints use:

```http
Authorization: Bearer <JWT>
```

### Authentication

- `POST /api/auth/login`

Body:

```json
{
  "username": "admin",
  "password": "admin123"
}
```

### Machines

- `GET /api/machines`
- `GET /api/machines/:id`
- `POST /api/machines` (admin)
- `PATCH /api/machines/:id` (admin)

### Tasks

- `GET /api/tasks`
- `GET /api/tasks/:id`
- `POST /api/tasks`
- `PATCH /api/tasks/:id`

### Daily machine logs

- `GET /api/daily-logs`
- `POST /api/daily-logs`

Adding a daily log automatically evaluates runtime and temperature rules and can create alerts.

### Breakdowns

- `GET /api/breakdowns`
- `POST /api/breakdowns`
- `PATCH /api/breakdowns/:id`

Downtime cost is automatically calculated using `DOWNTIME_COST_PER_HOUR` (default ₹500/hour).

### Alerts

- `GET /api/alerts`
- `POST /api/alerts`
- `PATCH /api/alerts/:id/read`
- `PATCH /api/alerts/read-all`
- `PATCH /api/alerts/:id/task-created`
- `DELETE /api/alerts/:id`

### Team

- `GET /api/team`
- `POST /api/team` (admin)
- `PATCH /api/team/:id` (admin)

### Admin approval

- `GET /api/admin/approvals` (admin)
- `PATCH /api/admin/approvals/:taskId` (admin)

### Reports

- `GET /api/reports/dashboard`
- `GET /api/reports/machines/:id`
- `GET /api/reports/maintenance`

### Health

- `GET /health`

## Database design

The schema includes:

`users`, `machines`, `tasks`, `daily_machine_logs`, `breakdown_logs`, `alerts`, `team_members`, `repair_records`, and `task_approvals`.

The database uses foreign keys, indexes, constraints, and parameterized SQL queries.

## Frontend untouched

This package is backend-only. The original frontend files were inspected for contracts but were not edited.
