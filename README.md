# 🇸🇬 SG Bus Kaki PWA

> **Modern Singapore Bus & Transit Progressive Web App (PWA)**  
> Built for Singapore commuters and Android users. Features real-time bus arrivals, offline-first search in MRT tunnels, dynamic arrival push alerts, and an active ride alighting wake-up alarm.

---

## 📖 Project Documentation

Complete technical plans and architectural blueprints are available in this directory:
- [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) — Step-by-step roadmap, feature checklists, and phased execution.
- [ARCHITECTURE.md](./ARCHITECTURE.md) — System diagrams, Web Push VAPID specs, Screen Wake Lock mechanics, and database schemas.

---

## ⚡ Quick Start

### 1. Prerequisites
- **Node.js** v18+ or v20+
- **npm** or **pnpm**
- **Supabase CLI** (for deploying the `pwa_api` edge function)

### 2. Installation & Development

```bash
# Navigate to the project directory
cd "C:\Users\tanse\Documents\Antigravity\PWA Buss App"

# Install frontend dependencies
npm install

# Start the local development server
npm run dev
```

### 3. Building for Production

```bash
npm run build
npm run preview
```

---

## 🔔 Web Push Setup (VAPID Keys)

To enable background notifications on Android devices:

### Step 1: Generate VAPID Key Pair
Run the following in your terminal:
```bash
npx web-push generate-vapid-keys
```
This produces:
- `Public Key` (used in frontend `.env` as `VITE_VAPID_PUBLIC_KEY`)
- `Private Key` (saved securely as Supabase Edge Function secret `VAPID_PRIVATE_KEY`)

### Step 2: Configure Environment Variables

Create `.env` in this directory:
```env
VITE_SUPABASE_URL=https://blcsjvifiytbznwesmyx.supabase.co
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_PWA_API_URL=https://blcsjvifiytbznwesmyx.supabase.co/functions/v1/pwa_api
VITE_VAPID_PUBLIC_KEY=your_generated_public_key
```

### Step 3: Deploy Supabase Database & Edge Function

1. Apply the PostgreSQL migration from `ARCHITECTURE.md` to your Supabase project SQL editor.
2. Deploy the `pwa_api` function:
   ```bash
   supabase functions deploy pwa_api --project-ref blcsjvifiytbznwesmyx
   ```
3. Set secrets:
   ```bash
   supabase secrets set VAPID_PUBLIC_KEY="your_public_key" VAPID_PRIVATE_KEY="your_private_key" LTA_DATAMALL_API_KEY="your_lta_key" --project-ref blcsjvifiytbznwesmyx
   ```

---

## 📱 Testing on Android Device

To test PWA installation, Screen Wake Lock, and Web Push notifications on an actual Android phone:

1. Connect your Android phone to your computer via USB.
2. Enable **USB Debugging** in Android Developer Options.
3. Open Google Chrome on your computer and navigate to: `chrome://inspect/#devices`.
4. Click **Port Forwarding**:
   - Port: `5173` ➔ `localhost:5173`.
5. Open Chrome on your Android phone and visit: `http://localhost:5173`.
6. Tap the Chrome menu (`⋮`) and select **"Add to Home Screen"** or tap the in-app **"Install App"** prompt banner.
7. Open the newly installed app icon from your Android home screen to launch in full-screen standalone mode!
