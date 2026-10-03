# Dispatch Map App

This is a Vite + React application built for real-time dispatch mapping with a kiosk display, powered by Supabase Broadcast and Presence. It is configured to run as a Progressive Web App (PWA) and can be hosted on Vercel.

## Tech Stack
- **React & Vite**
- **Material UI (MUI)**
- **Leaflet & React-Leaflet** (OpenStreetMap + Satellite layers)
- **Supabase** (Broadcast for real-time map updates & Presence for online users)
- **Vite PWA Plugin** (Standalone installation capabilities)

## Setup Instructions

### 1. Supabase Setup
1. Create a new Supabase project.
2. Go to project settings and get the URL and Anon Key.
3. Rename `.env.example` to `.env` and fill in the values:
```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### 2. Running Locally
Install dependencies and run the development server:
```bash
npm install
npm run dev
```

### 3. Vercel Deployment
To deploy to Vercel:
1. Push this code to a GitHub repository.
2. Import the project in Vercel.
3. Vercel will automatically detect the Vite framework.
4. Add the `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to the Environment Variables section in the Vercel project settings.
5. Deploy!

*Note: A `vercel.json` file is already included to handle React Router client-side routing rewrites.*
