# DriveMatch — Live Demo

An AI-powered used car recommendation engine. A 7-step wizard collects budget, passengers, body style preferences, priorities, and dealbreakers; on submit, a serverless function asks GPT-4o for three ranked car picks with reliability data and a 25-year heat map.

## Stack

- Static `index.html` (no build step, no framework)
- Single Vercel serverless function at `api/recommend.js` that proxies prompts to OpenAI
- The OpenAI API key is stored as a Vercel environment variable, never exposed to the browser

## Deploy to Vercel

1. **Push this folder to its own GitHub repo** (e.g. `drivematch`):
   ```powershell
   cd "C:\Users\helin\OneDrive\Documents\Coding\Site Portfolio\drivematch"
   git init
   git add .
   git commit -m "Initial commit"
   gh repo create drivematch --public --source=. --push
   ```

2. **Import the repo at https://vercel.com/new** and accept the defaults. Vercel auto-detects the static HTML and the `api/` function.

3. **Add the OpenAI key as an env var:**
   - In the Vercel project settings, go to **Settings → Environment Variables**
   - Name: `OPENAI_API_KEY`
   - Value: your `sk-...` key
   - Environments: all (Production, Preview, Development)
   - Redeploy if needed (Settings → Deployments → Redeploy)

4. **Test the live URL.** Fill out the wizard, click "Get My Cars". You should see three recommendation cards with the heat map.

5. **Send me the deployment URL** (e.g. `https://drivematch.vercel.app/`) and I'll wire it up as the demo link on the DriveMatch portfolio card.

## Cost

GPT-4o is ~$0.005 input / $0.015 output per 1K tokens. A typical DriveMatch request uses about 1K input and 1.5K output tokens, so each click is roughly **$0.03**. Free tier on Vercel covers the function hosting.

To reduce cost, edit `api/recommend.js` and change `model: 'gpt-4o'` to `model: 'gpt-4o-mini'` — roughly 10x cheaper, still capable for this task.

**Always set a spend cap on your OpenAI account** at https://platform.openai.com/account/limits — recommended $5–$10/month for a portfolio demo.

## Rate limiting (optional but recommended)

`api/recommend.js` supports IP-based rate limiting via Upstash Redis. Without it, anyone who knows the URL can spam the endpoint.

1. Sign up at [upstash.com](https://upstash.com/) (free tier covers this)
2. Create a Redis database (any region close to your Vercel region)
3. Copy **REST URL** and **REST Token** from the database dashboard
4. In your Vercel project: **Settings → Environment Variables → Add**:
   - `UPSTASH_REDIS_REST_URL` = the REST URL
   - `UPSTASH_REDIS_REST_TOKEN` = the REST token
5. Redeploy

Default limit: **6 requests per IP per 60 seconds**. Adjust the constants at the top of `api/recommend.js` to taste.

If the Upstash env vars aren't set, the function still works — it just skips rate limiting. So you can deploy without Upstash and add it later.

## Local development

The static HTML works on its own when opened from disk, but the API function does not — for that you need `vercel dev`:

```powershell
npm i -g vercel
vercel link            # link to the deployed project
vercel env pull        # pulls OPENAI_API_KEY from Vercel into .env.local
vercel dev             # runs locally with the function on http://localhost:3000
```

## Security notes

- **Never commit your `OPENAI_API_KEY`.** Use Vercel env vars only. The `.gitignore` excludes `.env` files.
- The endpoint is public; in theory anyone who finds the URL can call it. If you see suspicious usage on the OpenAI billing page, you can:
  - Rotate the key in Vercel settings, or
  - Add basic rate limiting in `api/recommend.js` (Upstash Redis is a common pattern).
