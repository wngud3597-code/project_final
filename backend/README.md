# Backend — Local setup

This document explains how to set the KMA weather API key and run the backend locally.

1. Create a local `.env` file:

```bash
cd backend
copy .env.example .env  # Windows
notepad .env
# set KMA_SERVICE_KEY=YOUR_KEY
```

Or run the helper on Windows:

```bash
backend\open-weather-key.cmd
```

2. Start the server:

```bash
python backend/server.py
```

3. Test the weather endpoint (after server starts):

```bash
curl "http://127.0.0.1:8000/api/weather?lat=37.5665&lon=126.9780"
```

Security notes:
- Do NOT commit `backend/.env`. The repository's `.gitignore` already excludes it.
- For production, store `KMA_SERVICE_KEY` in your deployment platform's secret store (Netlify/GitHub Actions, etc.).
