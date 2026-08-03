# SCG Admin Dashboard

Local, single-user admin dashboard. React/TypeScript frontend, Node.js backend, SQLite storage.

## Requirements
- Node.js 22.5 or newer (uses the built-in `node:sqlite` module, no extra database driver needed)

## Project structure
```
scg-admin-dashboard/
├── frontend/   # React + TypeScript + Vite
└── backend/    # Express API + SQLite (scg.db created automatically on first run)
```

## Running it

Open two terminal tabs.

**Terminal 1 - backend:**
```
cd backend
npm install
npm start
```
Runs at http://localhost:4000

**Terminal 2 - frontend:**
```
cd frontend
npm install
npm run dev
```
Runs at http://localhost:5173 (Vite will tell you the exact port)

## What's built so far
- Price Calculator backend logic: `(sum of item costs x 1.20) + delivery fee (no markup)`
- Endpoints:
  - `POST /api/price-calculator/calculate` - returns a quote breakdown
  - `POST /api/price-calculator/save` - saves a quote to SQLite
  - `GET /api/price-calculator/quotes` - lists saved quotes
- Frontend is the default Vite scaffold, not yet wired to the backend

## Not built yet
Orders, Customer Database, Template Library, Gift Packages, Delivery Schedule, QR Code Generator, Expense Tracker, Monthly Profit, Settings
