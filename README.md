# Jomish Booking and Delivering Management System

A full-stack booking and product delivery management platform built with Node.js, Express, PostgreSQL, Socket.io, and Pusher.

## Features
- **Product Ordering**: Frictionless client onboarding, real-time inventory decrement, and Pusher-powered "I'm Waiting" notifications.
- **Service Booking**: Dynamic time-slot engine, atomic booking locks preventing double-booking, and real-time Socket.io availability syncing.
- **Seller Dashboard**: Multi-business POS-styled interface with order/booking management, live status updates, and auto-saving client notes.
- **In-App Chat**: Bidirectional real-time Socket.io messaging between clients and the seller.

## Tech Stack
- **Frontend**: Vanilla HTML/CSS/JS (Progressive Web App style)
- **Backend**: Node.js + Express
- **Database**: PostgreSQL (Neon)
- **Real-Time**: Socket.io (Chat & Slot sync) + Pusher (Seller alerts)

## Local Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   Copy `.env.example` to `.env` and fill in your credentials.
   ```bash
   cp .env.example .env
   ```

3. **Initialize Database:**
   Run the SQL statements in `server/schema.sql` against your PostgreSQL database. This includes table creation and demo seed data.
   *(We recommend using a free Neon PostgreSQL database).*

4. **Start the server:**
   ```bash
   npm start
   ```

5. **Access the application:**
   - Landing Page: `http://localhost:3000`
   - Demo Product Ordering: `http://localhost:3000/order/jomish-cafe`
   - Demo Service Booking: `http://localhost:3000/book/jomish-salon`
   - Seller Dashboard: `http://localhost:3000/seller`

## Deployment
This repository includes a `render.yaml` for automatic deployment to [Render](https://render.com). Link your GitHub repository in Render and provide the necessary environment variables in the Render dashboard.
